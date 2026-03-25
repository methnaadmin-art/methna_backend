import {
    Injectable,
    UnauthorizedException,
    ConflictException,
    Logger,
    InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { User, UserStatus } from '../../database/entities/user.entity';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import { RedisService } from '../redis/redis.service';
import { OtpService } from '../otp/otp.service';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        private readonly redisService: RedisService,
        private readonly otpService: OtpService,
    ) { }

    async register(registerDto: RegisterDto) {
        const { email, password, firstName, lastName, phone } = registerDto;
        this.logger.log(`[REGISTER START] email=${email}`);

        try {
            // Check if user exists
            this.logger.log('[REGISTER] Before DB findOne');
            const existingUser = await this.userRepository.findOne({
                where: { email },
            });
            this.logger.log(`[REGISTER] After DB findOne — exists=${!!existingUser}`);

            if (existingUser) {
                throw new ConflictException('Email already registered');
            }

            // Hash password
            this.logger.log('[REGISTER] Before bcrypt hash');
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);
            this.logger.log('[REGISTER] After bcrypt hash');

            // Create user
            this.logger.log('[REGISTER] Before DB save');
            const user = this.userRepository.create({
                email,
                password: hashedPassword,
                firstName,
                lastName,
                phone,
            });

            await this.userRepository.save(user);
            this.logger.log(`[REGISTER] After DB save — userId=${user.id}`);

            // Generate tokens
            this.logger.log('[REGISTER] Before generateTokens');
            const tokens = await this.generateTokens(user);
            this.logger.log('[REGISTER] After generateTokens');

            // Store refresh token
            this.logger.log('[REGISTER] Before updateRefreshToken');
            await this.updateRefreshToken(user.id, tokens.refreshToken);
            this.logger.log('[REGISTER] After updateRefreshToken');

            // Send OTP email (NON-BLOCKING — never throws)
            this.logger.log('[REGISTER] Sending OTP email (non-blocking)');
            this.otpService.generateAndSend(email).catch((err) => {
                this.logger.error(`[REGISTER] OTP send failed (non-blocking): ${err.message}`);
            });

            this.logger.log(`[REGISTER DONE] User registered: ${email}`);

            return {
                user: this.sanitizeUser(user),
                ...tokens,
            };
        } catch (error) {
            this.logger.error(`[REGISTER ERROR] ${error.message}`, error.stack);
            if (error instanceof ConflictException) throw error;
            // Handle PostgreSQL unique constraint violation (e.g. duplicate email/username)
            if (error?.code === '23505' || error?.driverError?.code === '23505') {
                const detail = error?.driverError?.detail || error?.detail || '';
                this.logger.warn(`[REGISTER] Duplicate key: ${detail}`);
                throw new ConflictException('Email or username already registered');
            }
            throw new InternalServerErrorException('Registration failed: ' + error.message);
        }
    }

    async login(loginDto: LoginDto) {
        const { email, password } = loginDto;
        this.logger.log(`[LOGIN START] email=${email}`);

        try {
            this.logger.log('[LOGIN] Before DB findOne');
            const user = await this.userRepository.findOne({
                where: { email },
                select: [
                    'id',
                    'email',
                    'password',
                    'firstName',
                    'lastName',
                    'role',
                    'status',
                ],
            });
            this.logger.log(`[LOGIN] After DB findOne — found=${!!user}`);

            if (!user) {
                throw new UnauthorizedException('Invalid credentials');
            }

            if (user.status !== UserStatus.ACTIVE) {
                throw new UnauthorizedException('Account is not active');
            }

            // Verify password
            this.logger.log('[LOGIN] Before bcrypt compare');
            const isPasswordValid = await bcrypt.compare(password, user.password);
            this.logger.log(`[LOGIN] After bcrypt compare — valid=${isPasswordValid}`);

            if (!isPasswordValid) {
                throw new UnauthorizedException('Invalid credentials');
            }

            // Generate tokens
            this.logger.log('[LOGIN] Before generateTokens');
            const tokens = await this.generateTokens(user);
            this.logger.log('[LOGIN] After generateTokens');

            // Update refresh token & last login
            this.logger.log('[LOGIN] Before updateRefreshToken + lastLoginAt');
            await this.updateRefreshToken(user.id, tokens.refreshToken);
            await this.userRepository.update(user.id, { lastLoginAt: new Date() });
            this.logger.log('[LOGIN] After updateRefreshToken + lastLoginAt');

            this.logger.log(`[LOGIN DONE] User logged in: ${email}`);

            return {
                user: this.sanitizeUser(user),
                ...tokens,
            };
        } catch (error) {
            this.logger.error(`[LOGIN ERROR] ${error.message}`, error.stack);
            if (error instanceof UnauthorizedException) throw error;
            throw new InternalServerErrorException('Login failed: ' + error.message);
        }
    }

    async verifyOtp(email: string, code: string) {
        this.logger.log(`[VERIFY OTP] email=${email}`);
        await this.otpService.verify(email, code);

        // Mark email as verified
        await this.userRepository.update(
            { email },
            { emailVerified: true },
        );
        this.logger.log(`[VERIFY OTP] ✅ Email verified: ${email}`);

        return { message: 'Email verified successfully' };
    }

    async resendOtp(email: string) {
        this.logger.log(`[RESEND OTP] email=${email}`);

        // Check that user exists
        const user = await this.userRepository.findOne({ where: { email } });
        if (!user) {
            throw new UnauthorizedException('User not found');
        }

        return this.otpService.resend(email);
    }

    async refreshTokens(refreshToken: string) {
        this.logger.log('[REFRESH] Start');
        try {
            const payload = this.jwtService.verify(refreshToken, {
                secret: this.configService.get<string>('jwt.refreshSecret'),
            });

            this.logger.log('[REFRESH] Before DB findOne');
            const user = await this.userRepository.findOne({
                where: { id: payload.sub },
                select: ['id', 'email', 'firstName', 'lastName', 'role', 'refreshToken'],
            });
            this.logger.log(`[REFRESH] After DB findOne — found=${!!user}`);

            if (!user || !user.refreshToken) {
                throw new UnauthorizedException('Invalid refresh token');
            }

            const isRefreshValid = await bcrypt.compare(
                refreshToken,
                user.refreshToken,
            );
            if (!isRefreshValid) {
                throw new UnauthorizedException('Invalid refresh token');
            }

            const tokens = await this.generateTokens(user);
            await this.updateRefreshToken(user.id, tokens.refreshToken);

            this.logger.log('[REFRESH DONE]');
            return tokens;
        } catch (error) {
            this.logger.error(`[REFRESH ERROR] ${error.message}`);
            throw new UnauthorizedException('Invalid refresh token');
        }
    }

    async logout(userId: string) {
        this.logger.log(`[LOGOUT] userId=${userId}`);
        await this.userRepository.update(userId, { refreshToken: undefined });
        await this.redisService.setUserOffline(userId);
        this.logger.log('[LOGOUT DONE]');
    }

    private async generateTokens(user: User) {
        const payload = { sub: user.id, email: user.email, role: user.role };

        const [accessToken, refreshToken] = await Promise.all([
            this.jwtService.signAsync(payload),
            this.jwtService.signAsync(payload, {
                secret: this.configService.get<string>('jwt.refreshSecret'),
                expiresIn: this.configService.get<string>('jwt.refreshExpiration'),
            }),
        ]);

        return { accessToken, refreshToken };
    }

    private async updateRefreshToken(userId: string, refreshToken: string) {
        const salt = await bcrypt.genSalt(10);
        const hashedRefreshToken = await bcrypt.hash(refreshToken, salt);
        await this.userRepository.update(userId, {
            refreshToken: hashedRefreshToken,
        });
    }

    private sanitizeUser(user: User) {
        const { password, refreshToken, ...sanitized } = user;
        return sanitized;
    }
}

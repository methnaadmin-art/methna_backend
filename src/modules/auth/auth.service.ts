import {
    Injectable,
    UnauthorizedException,
    ConflictException,
    BadRequestException,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { User, UserStatus } from '../../database/entities/user.entity';
import {
    RegisterDto,
    LoginDto,
    VerifyOtpDto,
    ResendOtpDto,
    ForgotPasswordDto,
    VerifyResetOtpDto,
    ResetPasswordDto,
} from './dto/auth.dto';
import { RedisService } from '../redis/redis.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        private readonly redisService: RedisService,
        private readonly mailService: MailService,
    ) { }

    // ─── REGISTRATION WITH OTP ──────────────────────────────

    async register(registerDto: RegisterDto) {
        const { email, password, firstName, lastName, phone, username } = registerDto;

        const existingUser = await this.userRepository.findOne({
            where: { email },
        });
        if (existingUser) {
            throw new ConflictException('Email already registered');
        }

        if (username) {
            const existingUsername = await this.userRepository.findOne({
                where: { username },
            });
            if (existingUsername) {
                throw new ConflictException('Username already taken');
            }
        }

        const salt = await bcrypt.genSalt(12);
        const hashedPassword = await bcrypt.hash(password, salt);

        const otp = this.generateOtp();
        const otpExpiry = new Date(
            Date.now() + this.configService.get<number>('otp.expirySeconds', 30) * 1000,
        );

        const user = this.userRepository.create({
            email,
            password: hashedPassword,
            firstName,
            lastName,
            phone,
            username,
            status: UserStatus.PENDING_VERIFICATION,
            otpCode: otp,
            otpExpiresAt: otpExpiry,
            otpAttempts: 0,
        });

        await this.userRepository.save(user);

        // Send OTP email (fire-and-forget with logging)
        this.mailService
            .sendOtpEmail(email, otp, firstName)
            .catch((err) => this.logger.error(`OTP email failed for ${email}`, err));

        this.logger.log(`User registered (pending verification): ${email}`);

        return {
            message: 'Registration successful. Please verify your email with the OTP sent.',
            email,
        };
    }

    async verifyOtp(dto: VerifyOtpDto) {
        const { email, otp } = dto;

        // Anti-bruteforce: rate limit OTP verifications
        const rateLimitKey = `otp_verify:${email}`;
        const allowed = await this.redisService.checkRateLimit(rateLimitKey, 10, 300);
        if (!allowed) {
            throw new HttpException('Too many OTP verification attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
        }

        const user = await this.userRepository.findOne({
            where: { email },
            select: [
                'id', 'email', 'firstName', 'lastName', 'role', 'status',
                'otpCode', 'otpExpiresAt', 'otpAttempts',
            ],
        });

        if (!user) {
            throw new BadRequestException('User not found');
        }

        if (user.status === UserStatus.ACTIVE && user.emailVerified) {
            throw new BadRequestException('Email already verified');
        }

        // Check max attempts
        const maxAttempts = this.configService.get<number>('otp.maxAttempts', 5);
        if (user.otpAttempts >= maxAttempts) {
            throw new HttpException('Maximum OTP attempts exceeded. Request a new OTP.', HttpStatus.TOO_MANY_REQUESTS);
        }

        // Check OTP expiry
        if (!user.otpCode || !user.otpExpiresAt || new Date() > user.otpExpiresAt) {
            throw new BadRequestException('OTP has expired. Request a new one.');
        }

        // Verify OTP
        if (user.otpCode !== otp) {
            await this.userRepository.update(user.id, {
                otpAttempts: user.otpAttempts + 1,
            });
            throw new BadRequestException('Invalid OTP code');
        }

        // Mark as verified
        await this.userRepository.update(user.id, {
            emailVerified: true,
            status: UserStatus.ACTIVE,
            otpCode: undefined,
            otpExpiresAt: undefined,
            otpAttempts: 0,
        });

        // Generate tokens
        user.status = UserStatus.ACTIVE;
        const tokens = await this.generateTokens(user);
        await this.updateRefreshToken(user.id, tokens.refreshToken);

        this.logger.log(`Email verified: ${email}`);

        return {
            message: 'Email verified successfully',
            user: this.sanitizeUser(user),
            ...tokens,
        };
    }

    async resendOtp(dto: ResendOtpDto) {
        const { email } = dto;

        // Anti-bruteforce: rate limit resend
        const rateLimitKey = `otp_resend:${email}`;
        const allowed = await this.redisService.checkRateLimit(rateLimitKey, 3, 300);
        if (!allowed) {
            throw new HttpException('Too many OTP resend requests. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
        }

        const user = await this.userRepository.findOne({
            where: { email },
            select: ['id', 'email', 'firstName', 'status', 'otpCooldownUntil'],
        });

        if (!user) {
            throw new BadRequestException('User not found');
        }

        if (user.status === UserStatus.ACTIVE) {
            throw new BadRequestException('Email already verified');
        }

        // Check cooldown
        const cooldownSeconds = this.configService.get<number>('otp.cooldownSeconds', 60);
        if (user.otpCooldownUntil && new Date() < user.otpCooldownUntil) {
            const remaining = Math.ceil(
                (user.otpCooldownUntil.getTime() - Date.now()) / 1000,
            );
            throw new BadRequestException(
                `Please wait ${remaining} seconds before requesting a new OTP`,
            );
        }

        const otp = this.generateOtp();
        const otpExpiry = new Date(
            Date.now() + this.configService.get<number>('otp.expirySeconds', 30) * 1000,
        );
        const cooldownUntil = new Date(Date.now() + cooldownSeconds * 1000);

        await this.userRepository.update(user.id, {
            otpCode: otp,
            otpExpiresAt: otpExpiry,
            otpAttempts: 0,
            otpCooldownUntil: cooldownUntil,
        });

        this.mailService
            .sendOtpEmail(email, otp, user.firstName)
            .catch((err) => this.logger.error(`Resend OTP email failed for ${email}`, err));

        return { message: 'New OTP sent to your email' };
    }

    // ─── LOGIN ──────────────────────────────────────────────

    async login(loginDto: LoginDto) {
        const { email, password } = loginDto;

        // Anti-bruteforce: rate limit login attempts
        const rateLimitKey = `login:${email}`;
        const allowed = await this.redisService.checkRateLimit(rateLimitKey, 5, 300);
        if (!allowed) {
            throw new HttpException('Too many login attempts. Try again in 5 minutes.', HttpStatus.TOO_MANY_REQUESTS);
        }

        const user = await this.userRepository.findOne({
            where: { email },
            select: [
                'id', 'email', 'password', 'firstName', 'lastName',
                'role', 'status', 'emailVerified',
            ],
        });

        if (!user) {
            throw new UnauthorizedException('Invalid credentials');
        }

        if (user.status === UserStatus.PENDING_VERIFICATION) {
            throw new UnauthorizedException('Please verify your email first');
        }

        if (user.status === UserStatus.BANNED) {
            throw new UnauthorizedException('Your account has been banned');
        }

        if (user.status === UserStatus.SUSPENDED) {
            throw new UnauthorizedException('Your account is suspended');
        }

        if (user.status !== UserStatus.ACTIVE) {
            throw new UnauthorizedException('Account is not active');
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const tokens = await this.generateTokens(user);
        await this.updateRefreshToken(user.id, tokens.refreshToken);
        await this.userRepository.update(user.id, { lastLoginAt: new Date() });

        this.logger.log(`User logged in: ${email}`);

        return {
            user: this.sanitizeUser(user),
            ...tokens,
        };
    }

    // ─── FORGOT PASSWORD ────────────────────────────────────

    async forgotPassword(dto: ForgotPasswordDto) {
        const { email } = dto;

        // Rate limit
        const rateLimitKey = `forgot_pwd:${email}`;
        const allowed = await this.redisService.checkRateLimit(rateLimitKey, 3, 300);
        if (!allowed) {
            throw new HttpException('Too many reset requests. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
        }

        const user = await this.userRepository.findOne({
            where: { email },
            select: ['id', 'email', 'firstName'],
        });

        // Always return success to prevent email enumeration
        if (!user) {
            return { message: 'If this email exists, a reset code has been sent' };
        }

        const otp = this.generateOtp();
        const otpExpiry = new Date(
            Date.now() + this.configService.get<number>('otp.expirySeconds', 30) * 1000,
        );

        await this.userRepository.update(user.id, {
            resetOtpCode: otp,
            resetOtpExpiresAt: otpExpiry,
            resetOtpAttempts: 0,
        });

        this.mailService
            .sendPasswordResetOtp(email, otp, user.firstName)
            .catch((err) => this.logger.error(`Reset OTP email failed for ${email}`, err));

        return { message: 'If this email exists, a reset code has been sent' };
    }

    async verifyResetOtp(dto: VerifyResetOtpDto) {
        const { email, otp } = dto;

        const rateLimitKey = `reset_verify:${email}`;
        const allowed = await this.redisService.checkRateLimit(rateLimitKey, 10, 300);
        if (!allowed) {
            throw new HttpException('Too many attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
        }

        const user = await this.userRepository.findOne({
            where: { email },
            select: ['id', 'resetOtpCode', 'resetOtpExpiresAt', 'resetOtpAttempts'],
        });

        if (!user) {
            throw new BadRequestException('Invalid request');
        }

        const maxAttempts = this.configService.get<number>('otp.maxAttempts', 5);
        if (user.resetOtpAttempts >= maxAttempts) {
            throw new HttpException('Maximum attempts exceeded. Request a new code.', HttpStatus.TOO_MANY_REQUESTS);
        }

        if (!user.resetOtpCode || !user.resetOtpExpiresAt || new Date() > user.resetOtpExpiresAt) {
            throw new BadRequestException('Reset code has expired');
        }

        if (user.resetOtpCode !== otp) {
            await this.userRepository.update(user.id, {
                resetOtpAttempts: user.resetOtpAttempts + 1,
            });
            throw new BadRequestException('Invalid reset code');
        }

        return { message: 'OTP verified. You may now reset your password.', verified: true };
    }

    async resetPassword(dto: ResetPasswordDto) {
        const { email, otp, newPassword } = dto;

        const user = await this.userRepository.findOne({
            where: { email },
            select: ['id', 'resetOtpCode', 'resetOtpExpiresAt', 'resetOtpAttempts'],
        });

        if (!user) {
            throw new BadRequestException('Invalid request');
        }

        if (!user.resetOtpCode || !user.resetOtpExpiresAt || new Date() > user.resetOtpExpiresAt) {
            throw new BadRequestException('Reset code has expired');
        }

        if (user.resetOtpCode !== otp) {
            throw new BadRequestException('Invalid reset code');
        }

        const salt = await bcrypt.genSalt(12);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        await this.userRepository.update(user.id, {
            password: hashedPassword,
            resetOtpCode: undefined,
            resetOtpExpiresAt: undefined,
            resetOtpAttempts: 0,
            refreshToken: undefined,
        });

        this.logger.log(`Password reset for: ${email}`);

        return { message: 'Password reset successfully. Please login with your new password.' };
    }

    // ─── TOKEN MANAGEMENT ───────────────────────────────────

    async refreshTokens(refreshToken: string) {
        try {
            const payload = this.jwtService.verify(refreshToken, {
                secret: this.configService.get<string>('jwt.refreshSecret'),
            });

            const user = await this.userRepository.findOne({
                where: { id: payload.sub },
                select: ['id', 'email', 'firstName', 'lastName', 'role', 'refreshToken'],
            });

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

            return tokens;
        } catch (error) {
            throw new UnauthorizedException('Invalid refresh token');
        }
    }

    async logout(userId: string) {
        await this.userRepository.update(userId, { refreshToken: null as any });
        await this.redisService.setUserOffline(userId);
        return { message: 'Logged out successfully' };
    }

    // ─── FCM TOKEN ──────────────────────────────────────────

    async updateFcmToken(userId: string, fcmToken: string) {
        await this.userRepository.update(userId, { fcmToken });
        return { message: 'FCM token updated' };
    }

    // ─── PRIVATE HELPERS ────────────────────────────────────

    private generateOtp(): string {
        return Math.floor(100000 + Math.random() * 900000).toString();
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
        const { password, refreshToken, otpCode, otpExpiresAt, otpAttempts, otpCooldownUntil, resetOtpCode, resetOtpExpiresAt, resetOtpAttempts, ...sanitized } = user as any;
        return sanitized;
    }
}

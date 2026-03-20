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
import { randomUUID, randomInt } from 'crypto';
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
            // Allow re-registration if user never verified their email
            if (existingUser.status === UserStatus.PENDING_VERIFICATION && !existingUser.emailVerified) {
                const salt = await bcrypt.genSalt(12);
                const hashedPassword = await bcrypt.hash(password, salt);
                const otp = this.generateOtp();
                const otpExpiry = new Date(
                    Date.now() + this.configService.get<number>('otp.expirySeconds', 30) * 1000,
                );

                existingUser.password = hashedPassword;
                existingUser.firstName = firstName;
                existingUser.lastName = lastName;
                if (phone !== undefined) existingUser.phone = phone;
                if (username !== undefined) existingUser.username = username;
                existingUser.otpCode = otp;
                existingUser.otpExpiresAt = otpExpiry;
                existingUser.otpAttempts = 0;

                await this.userRepository.save(existingUser);

                this.mailService
                    .sendOtpEmail(email, otp, firstName)
                    .catch((err) => this.logger.error(`OTP email failed for ${email}`, err));

                this.logger.log(`User re-registered (pending verification): ${email}`);

                return {
                    message: 'Registration successful. Please verify your email with the OTP sent.',
                    email,
                };
            }
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

    async login(loginDto: LoginDto, clientIp?: string, userAgent?: string) {
        const { email, password } = loginDto;

        // Anti-bruteforce: rate limit per email AND per IP
        const emailRateKey = `login:${email}`;
        const emailAllowed = await this.redisService.checkRateLimit(emailRateKey, 5, 300);
        if (!emailAllowed) {
            this.redisService.appendAuditLog({
                type: 'suspicious',
                action: 'login_rate_limit_email',
                email,
                ip: clientIp,
            }).catch(() => {});
            throw new HttpException('Too many login attempts. Try again in 5 minutes.', HttpStatus.TOO_MANY_REQUESTS);
        }

        if (clientIp) {
            const ipRateKey = `login_ip:${clientIp}`;
            const ipAllowed = await this.redisService.checkRateLimit(ipRateKey, 20, 300);
            if (!ipAllowed) {
                this.redisService.appendAuditLog({
                    type: 'suspicious',
                    action: 'login_rate_limit_ip',
                    ip: clientIp,
                }).catch(() => {});
                throw new HttpException('Too many login attempts from this IP. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
            }
        }

        const user = await this.userRepository.findOne({
            where: { email },
            select: [
                'id', 'email', 'password', 'firstName', 'lastName',
                'role', 'status', 'emailVerified',
            ],
        });

        if (!user) {
            this.redisService.appendAuditLog({
                type: 'suspicious',
                action: 'login_failed_unknown_email',
                email,
                ip: clientIp,
            }).catch(() => {});
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
            this.redisService.appendAuditLog({
                type: 'suspicious',
                action: 'login_failed_bad_password',
                userId: user.id,
                email,
                ip: clientIp,
            }).catch(() => {});
            throw new UnauthorizedException('Invalid credentials');
        }

        const tokens = await this.generateTokens(user);
        await this.updateRefreshToken(user.id, tokens.refreshToken, tokens.familyId);
        await this.userRepository.update(user.id, { lastLoginAt: new Date(), lastKnownIp: clientIp || undefined });

        // Audit log — successful login with device fingerprint
        this.redisService.appendAuditLog({
            type: 'login',
            userId: user.id,
            email: user.email,
            action: 'login_success',
            familyId: tokens.familyId,
            ip: clientIp,
            userAgent,
        }).catch(() => {});

        this.logger.log(`User logged in: ${email} from ${clientIp}`);

        return {
            user: this.sanitizeUser(user),
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
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

        // Rate limit to prevent OTP brute-force via this endpoint
        const rateLimitKey = `reset_password:${email}`;
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
        let payload: any;
        try {
            payload = this.jwtService.verify(refreshToken, {
                secret: this.configService.get<string>('jwt.refreshSecret'),
            });
        } catch {
            throw new UnauthorizedException('Invalid refresh token');
        }

        const user = await this.userRepository.findOne({
            where: { id: payload.sub },
            select: ['id', 'email', 'firstName', 'lastName', 'role', 'refreshToken'],
        });

        if (!user || !user.refreshToken) {
            throw new UnauthorizedException('Invalid refresh token');
        }

        // Validate the refresh token hash
        const isRefreshValid = await bcrypt.compare(refreshToken, user.refreshToken);
        if (!isRefreshValid) {
            // ROTATION ATTACK DETECTED: someone is reusing an old refresh token.
            // This means the token family was compromised. Invalidate ALL sessions.
            this.logger.error(`SECURITY: Refresh token reuse detected for user ${user.id}. Invalidating all sessions.`);
            await this.redisService.invalidateAllUserSessions(user.id);
            await this.userRepository.update(user.id, { refreshToken: null as any });

            // Audit: suspicious activity
            this.redisService.appendAuditLog({
                type: 'suspicious',
                userId: user.id,
                email: user.email,
                action: 'refresh_token_reuse',
                detail: 'Possible token theft — all sessions invalidated',
                oldFamilyId: payload.familyId,
            }).catch(() => {});

            throw new UnauthorizedException('Session compromised. All sessions have been revoked.');
        }

        // Token family validation (if family tracking is present)
        if (payload.familyId) {
            const familyValid = await this.redisService.isTokenFamilyValid(user.id, payload.familyId);
            if (!familyValid) {
                this.logger.error(`SECURITY: Invalid token family ${payload.familyId} for user ${user.id}`);
                await this.redisService.invalidateAllUserSessions(user.id);
                await this.userRepository.update(user.id, { refreshToken: null as any });
                throw new UnauthorizedException('Session has been revoked.');
            }
        }

        // Issue new tokens (same family for rotation tracking)
        const tokens = await this.generateTokens(user, payload.familyId);
        await this.updateRefreshToken(user.id, tokens.refreshToken, tokens.familyId);

        // Audit log
        this.redisService.appendAuditLog({
            type: 'login',
            userId: user.id,
            action: 'token_refresh',
            familyId: tokens.familyId,
        }).catch(() => {});

        return {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
        };
    }

    async logout(userId: string, accessTokenJti?: string) {
        await this.userRepository.update(userId, { refreshToken: null as any });
        await this.redisService.setUserOffline(userId);

        // Blacklist the current access token so it can't be used anymore
        if (accessTokenJti) {
            // Blacklist for remaining TTL of access token (max 15 min)
            await this.redisService.blacklistToken(accessTokenJti, 900);
        }

        // Audit log
        this.redisService.appendAuditLog({
            type: 'login',
            userId,
            action: 'logout',
        }).catch(() => {});

        return { message: 'Logged out successfully' };
    }

    async revokeAllSessions(userId: string) {
        await this.redisService.invalidateAllUserSessions(userId);
        await this.userRepository.update(userId, { refreshToken: null as any });

        this.redisService.appendAuditLog({
            type: 'login',
            userId,
            action: 'revoke_all_sessions',
        }).catch(() => {});

        return { message: 'All sessions revoked' };
    }

    // ─── FCM TOKEN ──────────────────────────────────────────

    async updateFcmToken(userId: string, fcmToken: string) {
        await this.userRepository.update(userId, { fcmToken });
        return { message: 'FCM token updated' };
    }

    // ─── PRIVATE HELPERS ────────────────────────────────────

    private generateOtp(): string {
        return randomInt(100000, 999999).toString();
    }

    private async generateTokens(user: User, existingFamilyId?: string) {
        const familyId = existingFamilyId || randomUUID();
        const accessJti = randomUUID();
        const refreshJti = randomUUID();

        const basePayload = { sub: user.id, email: user.email, role: user.role, familyId };

        const [accessToken, refreshToken] = await Promise.all([
            this.jwtService.signAsync({ ...basePayload, jti: accessJti }),
            this.jwtService.signAsync({ ...basePayload, jti: refreshJti }, {
                secret: this.configService.get<string>('jwt.refreshSecret'),
                expiresIn: this.configService.get<string>('jwt.refreshExpiration'),
            }),
        ]);

        // Store token family in Redis (TTL = refresh token TTL, ~7 days)
        await this.redisService.storeTokenFamily(user.id, familyId, 86400 * 7);

        return { accessToken, refreshToken, familyId };
    }

    private async updateRefreshToken(userId: string, refreshToken: string, familyId?: string) {
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

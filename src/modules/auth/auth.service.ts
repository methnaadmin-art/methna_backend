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
    ChangePasswordDto,
    GoogleSignInDto,
} from './dto/auth.dto';
import { RedisService } from '../redis/redis.service';
import { MailService } from '../mail/mail.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { UsersService } from '../users/users.service';
import { PaymentsService } from '../payments/payments.service';

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
        private readonly subscriptionsService: SubscriptionsService,
        private readonly usersService: UsersService,
        private readonly paymentsService: PaymentsService,
    ) { }

    // ─── REGISTRATION WITH OTP ──────────────────────────────

    async register(registerDto: RegisterDto) {
        const { email, password, firstName, lastName, phone, username } = registerDto;
        this.logger.log(`[OTP] Register request for ${email}`);

        const existingUser = await this.userRepository.findOne({
            where: { email },
            select: ['id', 'email', 'status', 'emailVerified'],
        });
        if (existingUser) {
            // Allow re-registration if user never verified their email
            if (existingUser.status === UserStatus.PENDING_VERIFICATION && !existingUser.emailVerified) {
                const salt = await bcrypt.genSalt(12);
                const hashedPassword = await bcrypt.hash(password, salt);
                const otp = this.generateOtp();
                this.logger.log(`[OTP] Generated OTP for re-register ${email}: ${otp}`);
                const hashedOtp = await bcrypt.hash(otp, 10);
                const otpExpiry = new Date(
                    Date.now() + this.configService.get<number>('otp.expirySeconds', 300) * 1000,
                );

                existingUser.password = hashedPassword;
                existingUser.firstName = firstName;
                existingUser.lastName = lastName;
                if (phone !== undefined) existingUser.phone = phone;
                if (username !== undefined) existingUser.username = username.toLowerCase();
                existingUser.otpCode = hashedOtp;
                existingUser.otpExpiresAt = otpExpiry;
                existingUser.otpAttempts = 0;

                await this.userRepository.save(existingUser);
                this.logger.log(`[OTP] Hashed OTP saved for ${email}, expiry=${otpExpiry.toISOString()}`);

                // Await email send so errors propagate
                let emailSent = false;
                try {
                    await this.mailService.sendOtpEmail(email, otp, firstName);
                    emailSent = true;
                    this.logger.log(`[OTP] ✅ Email sent successfully for ${email}`);
                } catch (err) {
                    this.logger.error(`[OTP] ❌ Email FAILED for ${email}: ${err?.message || err}`);
                }

                return {
                    message: 'Registration successful. Please verify your email with the OTP sent.',
                    email,
                    emailSent,
                };
            }
            throw new ConflictException('Email already registered');
        }

        if (username) {
            const existingUsername = await this.userRepository.findOne({
                where: { username: username.toLowerCase() },
                select: ['id', 'username', 'status', 'emailVerified'],
            });
            if (existingUsername && (existingUsername.status !== UserStatus.PENDING_VERIFICATION || existingUsername.emailVerified)) {
                throw new ConflictException('Username already taken');
            }
            // If the existing username belongs to an unverified user, release it
            if (existingUsername && existingUsername.status === UserStatus.PENDING_VERIFICATION && !existingUsername.emailVerified) {
                await this.userRepository.update(existingUsername.id, { username: () => 'NULL' } as any);
                this.logger.log(`[OTP] Released stale username '${username}' from unverified user ${existingUsername.id}`);
            }
        }

        const salt = await bcrypt.genSalt(12);
        const hashedPassword = await bcrypt.hash(password, salt);

        const otp = this.generateOtp();
        this.logger.log(`[OTP] Generated OTP for new user ${email}: ${otp}`);
        const hashedOtp = await bcrypt.hash(otp, 10);
        const otpExpiry = new Date(
            Date.now() + this.configService.get<number>('otp.expirySeconds', 300) * 1000,
        );

        const user = this.userRepository.create({
            email,
            password: hashedPassword,
            firstName,
            lastName,
            phone,
            username: username?.toLowerCase(),
            status: UserStatus.PENDING_VERIFICATION,
            otpCode: hashedOtp,
            otpExpiresAt: otpExpiry,
            otpAttempts: 0,
        });

        try {
            await this.userRepository.save(user);
        } catch (dbError) {
            // Handle PostgreSQL unique constraint violation (code 23505)
            if (dbError?.code === '23505' || dbError?.driverError?.code === '23505') {
                const detail = dbError?.driverError?.detail || dbError?.detail || '';
                this.logger.warn(`[OTP] Duplicate key violation: ${detail}`);
                if (detail.includes('username')) {
                    throw new ConflictException('Username already taken');
                }
                throw new ConflictException('Email already registered');
            }
            throw dbError;
        }
        this.logger.log(`[OTP] User created & hashed OTP saved for ${email}, expiry=${otpExpiry.toISOString()}`);

        // Await email send so errors propagate
        let emailSent = false;
        try {
            await this.mailService.sendOtpEmail(email, otp, firstName);
            emailSent = true;
            this.logger.log(`[OTP] ✅ Email sent successfully for ${email}`);
        } catch (err) {
            this.logger.error(`[OTP] ❌ Email FAILED for ${email}: ${err?.message || err}`);
        }

        return {
            message: 'Registration successful. Please verify your email with the OTP sent.',
            email,
            emailSent,
        };
    }

    async verifyOtp(dto: VerifyOtpDto) {
        const { email, otp } = dto;
        this.logger.log(`[OTP] Verify request for ${email}, code=${otp}`);

        // Anti-bruteforce: rate limit OTP verifications
        const rateLimitKey = `otp_verify:${email}`;
        const allowed = await this.redisService.checkRateLimit(rateLimitKey, 10, 300);
        if (!allowed) {
            this.logger.warn(`[OTP] Rate limited: ${email}`);
            throw new HttpException('Too many OTP verification attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
        }

        const user = await this.userRepository.findOne({
            where: { email },
            select: [
                'id', 'email', 'firstName', 'lastName', 'role', 'status',
                'otpCode', 'otpExpiresAt', 'otpAttempts', 'emailVerified',
            ],
        });

        if (!user) {
            this.logger.warn(`[OTP] User not found: ${email}`);
            throw new BadRequestException('User not found');
        }

        this.logger.log(`[OTP] User found: ${email}, status=${user.status}, emailVerified=${user.emailVerified}, hasOtp=${!!user.otpCode}, otpExpiry=${user.otpExpiresAt}, attempts=${user.otpAttempts}`);

        if (user.status === UserStatus.ACTIVE && user.emailVerified) {
            throw new BadRequestException('Email already verified');
        }

        // Check max attempts
        const maxAttempts = this.configService.get<number>('otp.maxAttempts', 5);
        if (user.otpAttempts >= maxAttempts) {
            this.logger.warn(`[OTP] Max attempts exceeded for ${email}: ${user.otpAttempts}/${maxAttempts}`);
            throw new HttpException('Maximum OTP attempts exceeded. Request a new OTP.', HttpStatus.TOO_MANY_REQUESTS);
        }

        // Check OTP expiry
        if (!user.otpCode || !user.otpExpiresAt || new Date() > user.otpExpiresAt) {
            this.logger.warn(`[OTP] Expired for ${email}: otpExpiresAt=${user.otpExpiresAt}, now=${new Date().toISOString()}`);
            throw new BadRequestException('OTP has expired. Request a new one.');
        }

        // Verify OTP using bcrypt compare (OTP is hashed in DB)
        const isMatch = await bcrypt.compare(otp, user.otpCode);
        this.logger.log(`[OTP] bcrypt.compare result for ${email}: ${isMatch}`);

        if (!isMatch) {
            await this.userRepository.update(user.id, {
                otpAttempts: user.otpAttempts + 1,
            });
            this.logger.warn(`[OTP] Invalid code for ${email}. Attempts: ${user.otpAttempts + 1}/${maxAttempts}`);
            throw new BadRequestException('Invalid OTP code');
        }

        // Mark as verified
        await this.userRepository.update(user.id, {
            emailVerified: true,
            status: UserStatus.ACTIVE,
            otpExpiresAt: null as any,
            otpAttempts: 0,
        });

        // Grant 3-day free premium trial
        try {
            await this.subscriptionsService.createTrialSubscription(user.id, 3);
            this.logger.log(`[OTP] 🎁 Trial subscription granted to ${email}`);
        } catch (trialErr) {
            this.logger.error(`[OTP] ❌ Failed to grant trial to ${email}: ${(trialErr as Error).message}`);
        }

        // Stripe Customer Creation
        try {
            const stripeCustomerId = await this.paymentsService.createCustomer(user.email, `${user.firstName} ${user.lastName}`);
            if (stripeCustomerId) {
                await this.userRepository.update(user.id, { stripeCustomerId });
                this.logger.log(`[Stripe] ✅ Created Stripe customer for ${email}`);
            }
        } catch (stripeErr) {
            this.logger.error(`[Stripe] ❌ Failed to create customer for ${email}: ${(stripeErr as Error).message}`);
        }

        // Generate tokens
        user.status = UserStatus.ACTIVE;
        const tokens = await this.generateTokens(user);
        await this.updateRefreshToken(user.id, tokens.refreshToken);

        this.logger.log(`[OTP] ✅ Email verified successfully: ${email}`);

        return {
            message: 'Email verified successfully',
            user: this.sanitizeUser(await this.usersService.getMe(user.id)),
            ...tokens,
        };
    }

    async resendOtp(dto: ResendOtpDto) {
        const { email } = dto;
        this.logger.log(`[OTP] Resend request for ${email}`);

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
        this.logger.log(`[OTP] Generated new OTP for resend ${email}: ${otp}`);
        const hashedOtp = await bcrypt.hash(otp, 10);
        const otpExpiry = new Date(
            Date.now() + this.configService.get<number>('otp.expirySeconds', 300) * 1000,
        );
        const cooldownUntil = new Date(Date.now() + cooldownSeconds * 1000);

        await this.userRepository.update(user.id, {
            otpCode: hashedOtp,
            otpExpiresAt: otpExpiry,
            otpAttempts: 0,
            otpCooldownUntil: cooldownUntil,
        });
        this.logger.log(`[OTP] Hashed OTP saved for resend ${email}, expiry=${otpExpiry.toISOString()}`);

        // Await email send
        let emailSent = false;
        try {
            await this.mailService.sendOtpEmail(email, otp, user.firstName);
            emailSent = true;
            this.logger.log(`[OTP] ✅ Resend email sent to ${email}`);
        } catch (err) {
            this.logger.error(`[OTP] ❌ Resend email FAILED for ${email}: ${err?.message || err}`);
        }

        return {
            message: 'New OTP sent to your email',
            emailSent,
        };
    }

    // ─── LOGIN ──────────────────────────────────────────────

    async login(loginDto: LoginDto, clientIp?: string, userAgent?: string) {
        const identifier = (loginDto.identifier || loginDto.email || '').trim();
        const normalizedIdentifier = identifier.toLowerCase();
        const normalizedPhone = identifier.replace(/\s+/g, '');
        const { password } = loginDto;

        if (!identifier) {
            throw new UnauthorizedException('Invalid credentials');
        }

        // Anti-bruteforce: rate limit per email AND per IP
        const emailRateKey = `login:${normalizedIdentifier || normalizedPhone}`;
        const emailAllowed = await this.redisService.checkRateLimit(emailRateKey, 5, 300);
        if (!emailAllowed) {
            this.redisService.appendAuditLog({
                type: 'suspicious',
                action: 'login_rate_limit_email',
                email: identifier,
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
            where: [
                { email: normalizedIdentifier },
                { username: normalizedIdentifier },
                { phone: identifier },
                { phone: normalizedPhone },
            ],
            select: [
                'id', 'email', 'password', 'firstName', 'lastName',
                'role', 'status', 'emailVerified',
            ],
        });

        if (!user) {
            this.redisService.appendAuditLog({
                type: 'suspicious',
                action: 'login_failed_unknown_email',
                email: identifier,
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
                email: identifier,
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

        this.logger.log(`User logged in: ${identifier} from ${clientIp}`);

        return {
            user: this.sanitizeUser(await this.usersService.getMe(user.id)),
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
        };
    }

    // ─── GOOGLE SIGN-IN ──────────────────────────────────────

    async googleSignIn(dto: GoogleSignInDto, clientIp?: string, userAgent?: string) {
        const { email, displayName, photoUrl } = dto;
        this.logger.log(`[GoogleSignIn] Processing for email=${email}`);

        // Check if user already exists
        let user = await this.userRepository.findOne({
            where: { email: email.toLowerCase() },
            select: ['id', 'email', 'firstName', 'lastName', 'role', 'status', 'emailVerified'],
        });

        if (user) {
            // Existing user - check status
            if (user.status === UserStatus.BANNED) {
                throw new UnauthorizedException('Your account has been banned');
            }
            if (user.status === UserStatus.SUSPENDED) {
                throw new UnauthorizedException('Your account is suspended');
            }

            // If user was pending verification, activate them (Google verifies email)
            if (user.status === UserStatus.PENDING_VERIFICATION) {
                await this.userRepository.update(user.id, {
                    status: UserStatus.ACTIVE,
                    emailVerified: true,
                });
                user.status = UserStatus.ACTIVE;
                user.emailVerified = true;
            }

            this.logger.log(`[GoogleSignIn] Existing user found: ${user.id}`);
        } else {
            // New user - create account
            const names = displayName?.split(' ') || ['User'];
            const firstName = names[0] || 'User';
            const lastName = names.slice(1).join(' ') || '';

            // Generate a random password (user won't use it, they'll use Google)
            const randomPassword = randomUUID();
            const hashedPassword = await bcrypt.hash(randomPassword, 12);

            // Generate unique username from email
            let baseUsername = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
            let username = baseUsername;
            let counter = 1;
            while (await this.userRepository.findOne({
                where: { username },
                select: ['id'],
            })) {
                username = `${baseUsername}${counter}`;
                counter++;
            }

            user = this.userRepository.create({
                email: email.toLowerCase(),
                password: hashedPassword,
                firstName,
                lastName,
                username,
                status: UserStatus.ACTIVE,
                emailVerified: true,
                lastKnownIp: clientIp,
            });

            await this.userRepository.save(user);
            this.logger.log(`[GoogleSignIn] New user created: ${user.id}`);

            // Grant trial subscription for new users
            try {
                await this.subscriptionsService.createTrialSubscription(user.id);
            } catch (err) {
                this.logger.warn(`[GoogleSignIn] Trial grant failed: ${err.message}`);
            }

            // Create Stripe customer
            try {
                const stripeCustomerId = await this.paymentsService.createCustomer(email, `${firstName} ${lastName}`);
                if (stripeCustomerId) {
                    await this.userRepository.update(user.id, { stripeCustomerId });
                }
            } catch (err) {
                this.logger.warn(`[GoogleSignIn] Stripe customer creation failed: ${err.message}`);
            }
        }

        // Generate tokens
        const tokens = await this.generateTokens(user);
        await this.updateRefreshToken(user.id, tokens.refreshToken, tokens.familyId);
        await this.userRepository.update(user.id, { lastLoginAt: new Date(), lastKnownIp: clientIp || undefined });

        // Audit log
        this.redisService.appendAuditLog({
            type: 'login',
            userId: user.id,
            email: user.email,
            action: 'google_signin_success',
            familyId: tokens.familyId,
            ip: clientIp,
            userAgent,
        }).catch(() => {});

        this.logger.log(`[GoogleSignIn] User authenticated: ${email} from ${clientIp}`);

        return {
            user: this.sanitizeUser(await this.usersService.getMe(user.id)),
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
        };
    }

    // ─── FORGOT PASSWORD ────────────────────────────────────

    async forgotPassword(dto: ForgotPasswordDto) {
        const { email } = dto;
        this.logger.log(`[OTP] Forgot password request for ${email}`);

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
            this.logger.warn(`[OTP] Forgot password — email not found: ${email}`);
            return { message: 'If this email exists, a reset code has been sent' };
        }

        const otp = this.generateOtp();
        this.logger.log(`[OTP] Generated reset OTP for ${email}: ${otp}`);
        const hashedOtp = await bcrypt.hash(otp, 10);
        const otpExpiry = new Date(
            Date.now() + this.configService.get<number>('otp.expirySeconds', 300) * 1000,
        );

        await this.userRepository.update(user.id, {
            resetOtpCode: hashedOtp,
            resetOtpExpiresAt: otpExpiry,
            resetOtpAttempts: 0,
        });
        this.logger.log(`[OTP] Hashed reset OTP saved for ${email}, expiry=${otpExpiry.toISOString()}`);

        try {
            await this.mailService.sendPasswordResetOtp(email, otp, user.firstName);
            this.logger.log(`[OTP] ✅ Reset email sent to ${email}`);
        } catch (err) {
            this.logger.error(`[OTP] ❌ Reset email FAILED for ${email}: ${err?.message || err}`);
        }

        return { message: 'If this email exists, a reset code has been sent' };
    }

    async verifyResetOtp(dto: VerifyResetOtpDto) {
        const { email, otp } = dto;
        this.logger.log(`[OTP] Verify reset OTP for ${email}`);

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
            this.logger.warn(`[OTP] Reset max attempts exceeded for ${email}`);
            throw new HttpException('Maximum attempts exceeded. Request a new code.', HttpStatus.TOO_MANY_REQUESTS);
        }

        if (!user.resetOtpCode || !user.resetOtpExpiresAt || new Date() > user.resetOtpExpiresAt) {
            this.logger.warn(`[OTP] Reset OTP expired for ${email}`);
            throw new BadRequestException('Reset code has expired');
        }

        const isMatch = await bcrypt.compare(otp, user.resetOtpCode);
        this.logger.log(`[OTP] Reset bcrypt.compare for ${email}: ${isMatch}`);

        if (!isMatch) {
            await this.userRepository.update(user.id, {
                resetOtpAttempts: user.resetOtpAttempts + 1,
            });
            throw new BadRequestException('Invalid reset code');
        }

        this.logger.log(`[OTP] ✅ Reset OTP verified for ${email}`);
        return { message: 'OTP verified. You may now reset your password.', verified: true };
    }

    async resetPassword(dto: ResetPasswordDto) {
        const { email, otp, newPassword } = dto;
        this.logger.log(`[OTP] Reset password request for ${email}`);

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

        const isMatch = await bcrypt.compare(otp, user.resetOtpCode);
        if (!isMatch) {
            await this.userRepository.update(user.id, {
                resetOtpAttempts: user.resetOtpAttempts + 1,
            });
            throw new BadRequestException('Invalid reset code');
        }

        const salt = await bcrypt.genSalt(12);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        await this.userRepository.update(user.id, {
            password: hashedPassword,
            resetOtpCode: null as any,
            resetOtpExpiresAt: null as any,
            resetOtpAttempts: 0,
            refreshToken: null as any,
        });

        this.logger.log(`[OTP] ✅ Password reset completed for: ${email}`);

        return { message: 'Password reset successfully. Please login with your new password.' };
    }

    // ─── TOKEN MANAGEMENT ───────────────────────────────────

    async changePassword(userId: string, dto: ChangePasswordDto) {
        const { oldPassword, newPassword } = dto;
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: ['id', 'password'],
        });

        if (!user) {
            throw new BadRequestException('User not found');
        }

        const isPasswordValid = await bcrypt.compare(oldPassword, user.password);
        if (!isPasswordValid) {
            throw new BadRequestException('Current password is incorrect');
        }

        if (oldPassword === newPassword) {
            throw new BadRequestException('New password must be different from the current password');
        }

        const salt = await bcrypt.genSalt(12);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        await this.userRepository.update(userId, {
            password: hashedPassword,
        });

        this.redisService.appendAuditLog({
            type: 'login',
            userId,
            action: 'password_changed',
        }).catch(() => {});

        return { message: 'Password changed successfully' };
    }

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

    // ─── QA TEST MODE: Fetch OTP (guarded by TEST_SECRET) ───

    async getTestOtp(email: string, testSecret: string) {
        const expectedSecret = this.configService.get<string>('TEST_SECRET');
        if (!expectedSecret || testSecret !== expectedSecret) {
            throw new UnauthorizedException('Invalid test secret');
        }

        const user = await this.userRepository.findOne({
            where: { email },
            select: ['id', 'email', 'otpCode', 'otpExpiresAt'],
        });

        if (!user || !user.otpCode) {
            throw new BadRequestException('No pending OTP for this email');
        }

        return { email, otp: user.otpCode, expiresAt: user.otpExpiresAt };
    }

    async checkUsernameAvailable(username: string): Promise<boolean> {
        return this.usersService.isUsernameAvailable(username);
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

    private sanitizeUser(user: any) {
        const { password, refreshToken, otpCode, otpExpiresAt, otpAttempts, otpCooldownUntil, resetOtpCode, resetOtpExpiresAt, resetOtpAttempts, ...sanitized } = user;
        return sanitized;
    }
}

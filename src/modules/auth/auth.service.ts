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
import { createPublicKey, randomUUID, randomInt, verify as verifySignature } from 'crypto';
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
    AppleSignInDto,
} from './dto/auth.dto';
import { RedisService } from '../redis/redis.service';
import { MailService } from '../mail/mail.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { UsersService } from '../users/users.service';
import { PaymentsService } from '../payments/payments.service';
type GoogleTokenInfo = {
    aud?: string;
    email?: string;
    email_verified?: boolean | string;
    name?: string;
    picture?: string;
    sub?: string;
    exp?: string;
    error?: string;
    error_description?: string;
};
type AppleIdentityTokenPayload = {
    iss?: string;
    aud?: string | string[];
    exp?: number;
    sub?: string;
    email?: string;
    email_verified?: boolean | string;
};
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
    ) {}
    private normalizeNamePart(value: string | null | undefined): string {
        const trimmed = value?.trim() ?? '';
        if (!trimmed) {
            return '';
        }
        return trimmed
            .split(/\s+/)
            .filter(Boolean)
            .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
            .join(' ');
    }
    // ─── REGISTRATION WITH OTP ──────────────────────────────
    async register(registerDto: RegisterDto) {
        const { email, password, firstName, lastName, phone, username, agreeToTerms, agreeToPrivacyPolicy } =
            registerDto;
        const normalizedFirstName = this.normalizeNamePart(firstName);
        const normalizedLastName = this.normalizeNamePart(lastName);
        if (!agreeToTerms || !agreeToPrivacyPolicy) {
            throw new BadRequestException('You must agree to the Terms of Service and Privacy Policy');
        }
        this.logger.log(`[OTP] Register request for ${email}`);
        const existingUser = await this.userRepository.findOne({
            where: { email },

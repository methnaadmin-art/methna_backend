import {
    Controller,
    Post,
    Body,
    HttpCode,
    HttpStatus,
    UseGuards,
    Patch,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import {
    RegisterDto,
    LoginDto,
    RefreshTokenDto,
    VerifyOtpDto,
    ResendOtpDto,
    ForgotPasswordDto,
    VerifyResetOtpDto,
    ResetPasswordDto,
    UpdateFcmTokenDto,
} from './dto/auth.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    // ─── Registration Flow ──────────────────────────────────

    @Public()
    @Post('register')
    @ApiOperation({ summary: 'Register a new user (sends OTP email)' })
    @ApiResponse({ status: 201, description: 'User registered, OTP sent' })
    @ApiResponse({ status: 409, description: 'Email already registered' })
    async register(@Body() registerDto: RegisterDto) {
        return this.authService.register(registerDto);
    }

    @Public()
    @Post('verify-otp')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Verify email with OTP code' })
    @ApiResponse({ status: 200, description: 'Email verified, tokens returned' })
    @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
    async verifyOtp(@Body() dto: VerifyOtpDto) {
        return this.authService.verifyOtp(dto);
    }

    @Public()
    @Post('resend-otp')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Resend OTP (with cooldown)' })
    @ApiResponse({ status: 200, description: 'New OTP sent' })
    @ApiResponse({ status: 429, description: 'Too many requests' })
    async resendOtp(@Body() dto: ResendOtpDto) {
        return this.authService.resendOtp(dto);
    }

    // ─── Login ──────────────────────────────────────────────

    @Public()
    @Post('login')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Login with email and password' })
    @ApiResponse({ status: 200, description: 'Login successful' })
    @ApiResponse({ status: 401, description: 'Invalid credentials' })
    @ApiResponse({ status: 429, description: 'Too many login attempts' })
    async login(@Body() loginDto: LoginDto) {
        return this.authService.login(loginDto);
    }

    // ─── Token Management ───────────────────────────────────

    @Public()
    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Refresh access token' })
    @ApiResponse({ status: 200, description: 'Tokens refreshed' })
    @ApiResponse({ status: 401, description: 'Invalid refresh token' })
    async refreshTokens(@Body() refreshTokenDto: RefreshTokenDto) {
        return this.authService.refreshTokens(refreshTokenDto.refreshToken);
    }

    @UseGuards(JwtAuthGuard)
    @Post('logout')
    @HttpCode(HttpStatus.OK)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Logout and invalidate refresh token' })
    async logout(@CurrentUser('sub') userId: string) {
        return this.authService.logout(userId);
    }

    // ─── Forgot Password Flow ───────────────────────────────

    @Public()
    @Post('forgot-password')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Request password reset OTP' })
    @ApiResponse({ status: 200, description: 'Reset OTP sent if email exists' })
    async forgotPassword(@Body() dto: ForgotPasswordDto) {
        return this.authService.forgotPassword(dto);
    }

    @Public()
    @Post('verify-reset-otp')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Verify password reset OTP' })
    @ApiResponse({ status: 200, description: 'OTP verified' })
    @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
    async verifyResetOtp(@Body() dto: VerifyResetOtpDto) {
        return this.authService.verifyResetOtp(dto);
    }

    @Public()
    @Post('reset-password')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Reset password with OTP' })
    @ApiResponse({ status: 200, description: 'Password reset successful' })
    @ApiResponse({ status: 400, description: 'Invalid OTP or request' })
    async resetPassword(@Body() dto: ResetPasswordDto) {
        return this.authService.resetPassword(dto);
    }

    // ─── FCM Token ──────────────────────────────────────────

    @UseGuards(JwtAuthGuard)
    @Patch('fcm-token')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Update FCM push notification token' })
    async updateFcmToken(
        @CurrentUser('sub') userId: string,
        @Body() dto: UpdateFcmTokenDto,
    ) {
        return this.authService.updateFcmToken(userId, dto.fcmToken);
    }
}

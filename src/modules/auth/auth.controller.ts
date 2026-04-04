import {
    Controller,
    Post,
    Body,
    HttpCode,
    HttpStatus,
    UseGuards,
    Patch,
    Req,
    Headers,
    Query,
    Get,
    Logger,
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
    ChangePasswordDto,
    UpdateFcmTokenDto,
    GoogleSignInDto,
} from './dto/auth.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
    private readonly logger = new Logger(AuthController.name);

    constructor(private readonly authService: AuthService) { }

    @Public()
    @Get('check-username')
    @ApiOperation({ summary: 'Check if a username is available' })
    @ApiResponse({ status: 200, description: 'Availability status returned' })
    async checkUsername(@Query('username') username: string) {
        const available = await this.authService.checkUsernameAvailable(username);
        return { available };
    }

    // ─── Registration Flow ──────────────────────────────────

    @Public()
    @Post('register')
    @ApiOperation({ summary: 'Register a new user (sends OTP email)' })
    @ApiResponse({ status: 201, description: 'User registered, OTP sent' })
    @ApiResponse({ status: 409, description: 'Email already registered' })
    async register(@Body() registerDto: RegisterDto) {
        try {
            this.logger.log(`[Register] Attempt for email=${registerDto.email}, username=${registerDto.username}`);
            const result = await this.authService.register(registerDto);
            this.logger.log(`[Register] Success for email=${registerDto.email}`);
            return result;
        } catch (error) {
            this.logger.error(`[Register] FAILED for email=${registerDto.email}: ${error.message}`, error.stack);
            throw error; // Re-throw to preserve ConflictException, BadRequestException, etc.
        }
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
    @ApiOperation({ summary: 'Login with email, username, or phone and password' })
    @ApiResponse({ status: 200, description: 'Login successful' })
    @ApiResponse({ status: 401, description: 'Invalid credentials' })
    @ApiResponse({ status: 429, description: 'Too many login attempts' })
    async login(@Body() loginDto: LoginDto, @Req() req: any) {
        return this.authService.login(loginDto, req.ip, req.headers['user-agent']);
    }

    // ─── Google Sign-In ─────────────────────────────────────

    @Public()
    @Post('google')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Sign in or register with Google' })
    @ApiResponse({ status: 200, description: 'Google sign-in successful' })
    @ApiResponse({ status: 401, description: 'Invalid Google token' })
    async googleSignIn(@Body() dto: GoogleSignInDto, @Req() req: any) {
        this.logger.log(`[GoogleSignIn] Attempt for email=${dto.email}`);
        try {
            const result = await this.authService.googleSignIn(dto, req.ip, req.headers['user-agent']);
            this.logger.log(`[GoogleSignIn] Success for email=${dto.email}`);
            return result;
        } catch (error) {
            this.logger.error(`[GoogleSignIn] FAILED for email=${dto.email}: ${error.message}`, error.stack);
            throw error;
        }
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
    @ApiOperation({ summary: 'Logout and invalidate refresh token + blacklist access token' })
    async logout(@CurrentUser('sub') userId: string, @CurrentUser('jti') jti: string) {
        return this.authService.logout(userId, jti);
    }

    @UseGuards(JwtAuthGuard)
    @Post('revoke-all-sessions')
    @HttpCode(HttpStatus.OK)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Revoke all active sessions for the current user' })
    async revokeAllSessions(@CurrentUser('sub') userId: string) {
        return this.authService.revokeAllSessions(userId);
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

    @UseGuards(JwtAuthGuard)
    @Patch('change-password')
    @HttpCode(HttpStatus.OK)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Change password for the current user' })
    async changePassword(
        @CurrentUser('sub') userId: string,
        @Body() dto: ChangePasswordDto,
    ) {
        return this.authService.changePassword(userId, dto);
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

    // ─── QA Test Mode ──────────────────────────────────────

    @Public()
    @Get('test-otp')
    @ApiOperation({ summary: 'Fetch OTP for testing (requires TEST_SECRET header)' })
    @ApiResponse({ status: 200, description: 'OTP returned' })
    @ApiResponse({ status: 401, description: 'Invalid test secret' })
    async getTestOtp(
        @Query('email') email: string,
        @Headers('x-test-secret') testSecret: string,
    ) {
        return this.authService.getTestOtp(email, testSecret);
    }
}

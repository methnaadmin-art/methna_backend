import { IsEmail, IsString, MinLength, MaxLength, IsOptional, Length, Matches, IsBoolean, Equals } from 'class-validator';
import { Match as MatchValidator } from '../../../common/decorators/match.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
    @ApiProperty({ example: 'user@example.com' })
    @IsEmail()
    email: string;

    @ApiProperty({ example: 'StrongP@ss123', minLength: 8 })
    @IsString()
    @MinLength(8)
    @MaxLength(128)
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
        message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number',
    })
    password: string;

    @ApiProperty({ example: 'StrongP@ss123' })
    @IsString()
    @MatchValidator('password', { message: 'Passwords do not match' })
    confirmPassword: string;

    @ApiProperty({ example: 'Ahmed' })
    @IsString()
    @MinLength(2)
    @MaxLength(50)
    firstName: string;

    @ApiProperty({ example: 'Al-Rashid' })
    @IsString()
    @MinLength(2)
    @MaxLength(50)
    lastName: string;

    @ApiPropertyOptional({ example: 'ahmed_rashid' })
    @IsOptional()
    @IsString()
    @MinLength(3)
    @MaxLength(30)
    @Matches(/^[a-zA-Z0-9_]+$/, { message: 'Username can only contain letters, numbers and underscores' })
    username?: string;

    @ApiPropertyOptional({ example: '+966501234567' })
    @IsOptional()
    @IsString()
    @Matches(/^\+?[0-9]{8,15}$/, { message: 'Phone number must be between 8 and 15 digits and can start with +' })
    phone?: string;

    @ApiProperty({
        example: true,
        description: 'Must be true to confirm user agreed to Terms of Service',
    })
    @IsBoolean()
    @Equals(true, { message: 'You must agree to the Terms of Service' })
    agreeToTerms: boolean;

    @ApiProperty({
        example: true,
        description: 'Must be true to confirm user agreed to Privacy Policy',
    })
    @IsBoolean()
    @Equals(true, { message: 'You must agree to the Privacy Policy' })
    agreeToPrivacyPolicy: boolean;
}

export class VerifyOtpDto {
    @ApiProperty({ example: 'user@example.com' })
    @IsEmail()
    email: string;

    @ApiProperty({ example: '123456', description: '6-digit OTP code' })
    @IsString()
    @Length(6, 6)
    otp: string;
}

export class ResendOtpDto {
    @ApiProperty({ example: 'user@example.com' })
    @IsEmail()
    email: string;
}

export class LoginDto {
    @ApiProperty({ example: 'user@example.com', description: 'Email, username, or phone number' })
    @IsOptional()
    @IsString()
    identifier?: string;

    @ApiPropertyOptional({ example: 'user@example.com', deprecated: true, description: 'Deprecated alias for identifier' })
    @IsOptional()
    @IsString()
    email?: string;

    @ApiProperty({ example: 'StrongP@ss123' })
    @IsString()
    password: string;
}

export class RefreshTokenDto {
    @ApiProperty()
    @IsString()
    refreshToken: string;
}

export class ForgotPasswordDto {
    @ApiProperty({ example: 'user@example.com' })
    @IsEmail()
    email: string;
}

export class VerifyResetOtpDto {
    @ApiProperty({ example: 'user@example.com' })
    @IsEmail()
    email: string;

    @ApiProperty({ example: '123456' })
    @IsString()
    @Length(6, 6)
    otp: string;
}

export class ResetPasswordDto {
    @ApiProperty({ example: 'user@example.com' })
    @IsEmail()
    email: string;

    @ApiProperty({ example: '123456' })
    @IsString()
    @Length(6, 6)
    otp: string;

    @ApiProperty({ example: 'NewStr0ngP@ss' })
    @IsString()
    @MinLength(8)
    @MaxLength(128)
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
        message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number',
    })
    newPassword: string;
}

export class ChangePasswordDto {
    @ApiProperty({ example: 'OldStr0ngP@ss' })
    @IsString()
    oldPassword: string;

    @ApiProperty({ example: 'NewStr0ngP@ss' })
    @IsString()
    @MinLength(8)
    @MaxLength(128)
    @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
        message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number',
    })
    newPassword: string;
}

export class UpdateFcmTokenDto {
    @ApiProperty()
    @IsString()
    fcmToken: string;
}

export class GoogleSignInDto {
    @ApiProperty({ description: 'Google ID token from client' })
    @IsString()
    idToken: string;

    @ApiProperty({ example: 'user@gmail.com' })
    @IsEmail()
    email: string;

    @ApiPropertyOptional({ example: 'John Doe' })
    @IsOptional()
    @IsString()
    displayName?: string;

    @ApiPropertyOptional({ example: 'https://...' })
    @IsOptional()
    @IsString()
    photoUrl?: string;
}

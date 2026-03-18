import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
    private readonly logger = new Logger(MailService.name);
    private transporter: nodemailer.Transporter;

    constructor(private readonly configService: ConfigService) {
        this.transporter = nodemailer.createTransport({
            host: this.configService.get<string>('mail.host'),
            port: this.configService.get<number>('mail.port'),
            secure: false,
            auth: {
                user: this.configService.get<string>('mail.user'),
                pass: this.configService.get<string>('mail.pass'),
            },
        });
        this.logger.log('Mail service initialized');
    }

    async sendOtpEmail(to: string, otp: string, name: string): Promise<void> {
        try {
            await this.transporter.sendMail({
                from: `"Wafaa App" <${this.configService.get<string>('mail.from')}>`,
                to,
                subject: 'Wafaa - Email Verification Code',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #2d7a4f;">Assalamu Alaikum ${name},</h2>
                        <p>Your verification code is:</p>
                        <div style="background: #f4f4f4; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
                            <h1 style="color: #2d7a4f; letter-spacing: 8px; font-size: 36px; margin: 0;">${otp}</h1>
                        </div>
                        <p>This code expires in <strong>30 seconds</strong>.</p>
                        <p>If you did not request this code, please ignore this email.</p>
                        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                        <p style="color: #999; font-size: 12px;">Wafaa - Halal Matchmaking Platform</p>
                    </div>
                `,
            });
            this.logger.log(`OTP email sent to ${to}`);
        } catch (error) {
            this.logger.error(`Failed to send OTP email to ${to}`, error);
            throw error;
        }
    }

    async sendPasswordResetOtp(to: string, otp: string, name: string): Promise<void> {
        try {
            await this.transporter.sendMail({
                from: `"Wafaa App" <${this.configService.get<string>('mail.from')}>`,
                to,
                subject: 'Wafaa - Password Reset Code',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #2d7a4f;">Assalamu Alaikum ${name},</h2>
                        <p>Your password reset code is:</p>
                        <div style="background: #f4f4f4; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
                            <h1 style="color: #c0392b; letter-spacing: 8px; font-size: 36px; margin: 0;">${otp}</h1>
                        </div>
                        <p>This code expires in <strong>30 seconds</strong>.</p>
                        <p>If you did not request this, please secure your account immediately.</p>
                        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                        <p style="color: #999; font-size: 12px;">Wafaa - Halal Matchmaking Platform</p>
                    </div>
                `,
            });
            this.logger.log(`Password reset OTP sent to ${to}`);
        } catch (error) {
            this.logger.error(`Failed to send reset OTP to ${to}`, error);
            throw error;
        }
    }
}

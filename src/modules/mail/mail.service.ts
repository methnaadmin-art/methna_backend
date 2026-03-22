import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
    private readonly logger = new Logger(MailService.name);
    private transporter: nodemailer.Transporter;

    constructor(private readonly configService: ConfigService) {
        const host = this.configService.get<string>('mail.host') || 'smtp.gmail.com';
        const port = this.configService.get<number>('mail.port') || 587;
        const user = this.configService.get<string>('mail.user');
        const pass = this.configService.get<string>('mail.pass');

        if (!user || !pass) {
            this.logger.warn('⚠️  MAIL_USER or MAIL_PASS not set — OTP emails will fail!');
        }

        this.transporter = nodemailer.createTransport({
            host,
            port,
            secure: port === 465,
            auth: { user, pass },
        });

        this.logger.log(`Mail service initialized (host=${host}, port=${port}, user=${user ? '✓' : '✗'})`);

        // Verify SMTP connection on startup (non-blocking)
        this.transporter.verify().then(() => {
            this.logger.log('✅ SMTP connection verified successfully');
        }).catch((err) => {
            this.logger.error('❌ SMTP connection verification failed — check MAIL_HOST/MAIL_USER/MAIL_PASS', err?.message);
        });
    }

    async sendOtpEmail(to: string, otp: string, name: string): Promise<void> {
        try {
            await this.transporter.sendMail({
                from: `"Methna App" <${this.configService.get<string>('mail.from') || 'noreply@methna.app'}>`,
                to,
                subject: 'Methna - Email Verification Code',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #2d7a4f;">Assalamu Alaikum ${name},</h2>
                        <p>Your verification code is:</p>
                        <div style="background: #f4f4f4; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
                            <h1 style="color: #2d7a4f; letter-spacing: 8px; font-size: 36px; margin: 0;">${otp}</h1>
                        </div>
                        <p>This code expires in <strong>5 minutes</strong>.</p>
                        <p>If you did not request this code, please ignore this email.</p>
                        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                        <p style="color: #999; font-size: 12px;">Methna - Halal Matchmaking Platform</p>
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
                from: `"Methna App" <${this.configService.get<string>('mail.from') || 'noreply@methna.app'}>`,
                to,
                subject: 'Methna - Password Reset Code',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #2d7a4f;">Assalamu Alaikum ${name},</h2>
                        <p>Your password reset code is:</p>
                        <div style="background: #f4f4f4; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
                            <h1 style="color: #c0392b; letter-spacing: 8px; font-size: 36px; margin: 0;">${otp}</h1>
                        </div>
                        <p>This code expires in <strong>5 minutes</strong>.</p>
                        <p>If you did not request this, please secure your account immediately.</p>
                        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                        <p style="color: #999; font-size: 12px;">Methna - Halal Matchmaking Platform</p>
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

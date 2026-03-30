import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailService {
    private readonly logger = new Logger(MailService.name);
    private resend: Resend;
    private readonly fromAddress: string;

    constructor(private readonly configService: ConfigService) {
        const apiKey = this.configService.get<string>('resend.apiKey');
        this.fromAddress = this.configService.get<string>('mail.from') || 'Methna App <verify@waqti.pro>';
        
        if (!apiKey) {
            this.logger.warn('⚠️ [RESEND] RESEND_API_KEY is NOT set — Emails will fail at send time');
            this.resend = null as any;
        } else {
            this.logger.log('✅ [RESEND] API Key is set');
            this.resend = new Resend(apiKey);
        }
    }

    async sendOtpEmail(to: string, otp: string, name: string): Promise<void> {
        this.logger.log(`[OTP-MAIL] Sending verification OTP via Resend to ${to} (name=${name})`);

        if (!this.resend) {
            this.logger.error(`❌ [OTP-MAIL] Cannot send — Resend client not initialized (missing API key)`);
            throw new Error('Mail service not configured: RESEND_API_KEY is missing');
        }

        try {
            const { data, error } = await this.resend.emails.send({
                from: this.fromAddress,
                to: [to],
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

            if (error) {
                this.logger.error(`❌ [OTP-MAIL] Resend failed for ${to}: ${error.message}`);
                throw new Error(error.message);
            }

            this.logger.log(`✅ [OTP-MAIL] Verification email sent to ${to} — id=${data?.id}`);
        } catch (error) {
            this.logger.error(`❌ [OTP-MAIL] Unexpected error sending via Resend: ${error.message}`);
            throw error;
        }
    }

    async sendPasswordResetOtp(to: string, otp: string, name: string): Promise<void> {
        this.logger.log(`[OTP-MAIL] Sending password reset OTP via Resend to ${to} (name=${name})`);

        if (!this.resend) {
            this.logger.error(`❌ [OTP-MAIL] Cannot send — Resend client not initialized (missing API key)`);
            throw new Error('Mail service not configured: RESEND_API_KEY is missing');
        }

        try {
            const { data, error } = await this.resend.emails.send({
                from: this.fromAddress,
                to: [to],
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

            if (error) {
                this.logger.error(`❌ [OTP-MAIL] Resend failed for ${to}: ${error.message}`);
                throw new Error(error.message);
            }

            this.logger.log(`✅ [OTP-MAIL] Reset email sent to ${to} — id=${data?.id}`);
        } catch (error) {
            this.logger.error(`❌ [OTP-MAIL] Unexpected error sending via Resend: ${error.message}`);
            throw error;
        }
    }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

const PDFDocument = require('pdfkit');

@Injectable()
export class MailService {
    private readonly logger = new Logger(MailService.name);
    private resend: Resend;
    private readonly fromAddress: string;
    private readonly agreementTemplateId: string;
    private readonly agreementDelayMs: number;

    constructor(private readonly configService: ConfigService) {
        const apiKey = this.configService.get<string>('resend.apiKey');
        this.fromAddress = this.configService.get<string>('mail.from') || 'Methna App <verify@waqti.pro>';
        this.agreementTemplateId =
            this.configService.get<string>('resend.agreementTemplateId') ||
            'agreement-confirmation';
        this.agreementDelayMs = this.configService.get<number>('resend.agreementDelayMs') || 120000;
        
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

    scheduleAgreementConfirmationEmail(to: string, name: string): boolean {
        if (!this.resend) {
            this.logger.warn(
                `[AGREEMENT-MAIL] Skipping schedule for ${to}: Resend client not initialized`,
            );
            return false;
        }

        const timer = setTimeout(() => {
            this.sendAgreementConfirmationEmail(to, name).catch((error: any) => {
                this.logger.error(
                    `❌ [AGREEMENT-MAIL] Delayed send failed for ${to}: ${error?.message || error}`,
                );
            });
        }, this.agreementDelayMs);

        if (typeof (timer as any).unref === 'function') {
            (timer as any).unref();
        }

        this.logger.log(
            `[AGREEMENT-MAIL] Scheduled terms/privacy PDF send to ${to} in ${this.agreementDelayMs}ms`,
        );
        return true;
    }

    async sendAgreementConfirmationEmail(to: string, name: string): Promise<void> {
        this.logger.log(
            `[AGREEMENT-MAIL] Sending agreement confirmation via Resend to ${to} using template ${this.agreementTemplateId}`,
        );

        if (!this.resend) {
            this.logger.error('❌ [AGREEMENT-MAIL] Cannot send — Resend client not initialized (missing API key)');
            throw new Error('Mail service not configured: RESEND_API_KEY is missing');
        }

        const sentAt = new Date().toISOString();
        try {
            const termsPdf = await this.generatePdfBuffer(
                'Methna Terms of Service',
                this.buildTermsDocumentBody(name, sentAt),
            );
            const privacyPdf = await this.generatePdfBuffer(
                'Methna Privacy Policy',
                this.buildPrivacyDocumentBody(name, sentAt),
            );

            const payload: any = {
                from: this.fromAddress,
                to: [to],
                subject: 'Methna - Terms & Privacy Policy (PDF)',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #2d7a4f;">Assalamu Alaikum ${name},</h2>
                        <p>Your OTP email was already sent.</p>
                        <p>
                            As requested, here are your agreement documents in PDF format:
                            <strong>Terms of Service</strong> and <strong>Privacy Policy</strong>.
                        </p>
                        <p><strong>Agreement timestamp:</strong> ${sentAt}</p>
                        <p><strong>Template ID:</strong> ${this.agreementTemplateId}</p>
                        <p>If this was not you, please contact support immediately.</p>
                        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                        <p style="color: #999; font-size: 12px;">Methna - Halal Matchmaking Platform</p>
                    </div>
                `,
                tags: [
                    {
                        name: 'template_id',
                        value: this.agreementTemplateId,
                    },
                ],
                attachments: [
                    {
                        filename: 'methna-terms-of-service.pdf',
                        content: termsPdf.toString('base64'),
                    },
                    {
                        filename: 'methna-privacy-policy.pdf',
                        content: privacyPdf.toString('base64'),
                    },
                ],
            };

            const { data, error } = await this.resend.emails.send(payload);

            if (error) {
                this.logger.error(`❌ [AGREEMENT-MAIL] Resend failed for ${to}: ${error.message}`);
                throw new Error(error.message);
            }

            this.logger.log(`✅ [AGREEMENT-MAIL] Agreement confirmation sent to ${to} — id=${data?.id}`);
        } catch (error) {
            this.logger.error(`❌ [AGREEMENT-MAIL] Unexpected error sending via Resend: ${error.message}`);
            throw error;
        }
    }

    private async generatePdfBuffer(title: string, content: string): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({ size: 'A4', margin: 48 });
            const chunks: Buffer[] = [];

            doc.on('data', (chunk: Buffer) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            doc.fontSize(18).text(title, { align: 'left' });
            doc.moveDown(0.75);
            doc.fontSize(11).text(content, {
                align: 'left',
                lineGap: 2,
            });
            doc.end();
        });
    }

    private buildTermsDocumentBody(name: string, sentAt: string): string {
        return [
            `Hello ${name},`,
            '',
            'This PDF confirms your acceptance of Methna Terms of Service.',
            `Agreement timestamp: ${sentAt}`,
            '',
            '1) Account and eligibility',
            '- You provide accurate account details and keep them updated.',
            '- You are responsible for safeguarding your login credentials.',
            '',
            '2) Acceptable use',
            '- No harassment, fraud, impersonation, abuse, or illegal activity.',
            '- Content violating platform safety rules may be removed.',
            '',
            '3) Moderation and enforcement',
            '- We may limit, suspend, or close accounts for policy violations.',
            '- Reports can be reviewed by moderation and admin teams.',
            '',
            '4) Subscription and billing',
            '- Paid features and renewals are processed via supported providers.',
            '- Charges and cancellation terms follow selected plan rules.',
            '',
            '5) Contact',
            '- If you have questions, contact support through the app settings.',
            '',
            `Template reference: ${this.agreementTemplateId}`,
        ].join('\n');
    }

    private buildPrivacyDocumentBody(name: string, sentAt: string): string {
        return [
            `Hello ${name},`,
            '',
            'This PDF confirms your acceptance of Methna Privacy Policy.',
            `Agreement timestamp: ${sentAt}`,
            '',
            '1) Data we collect',
            '- Account details such as email, profile details, and preferences.',
            '- Usage and security information needed to protect the platform.',
            '',
            '2) How data is used',
            '- To provide matchmaking, safety checks, and customer support.',
            '- To improve reliability, security, and user experience.',
            '',
            '3) Sharing and processing',
            '- Data may be processed by trusted service providers (for example: email and payments).',
            '- We do not sell personal data.',
            '',
            '4) Your controls',
            '- You can manage profile visibility and notification settings in-app.',
            '- You can request account actions through support channels.',
            '',
            '5) Security',
            '- Reasonable technical and operational safeguards are applied to protect data.',
            '',
            `Template reference: ${this.agreementTemplateId}`,
        ].join('\n');
    }
}

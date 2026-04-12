import {
    Controller,
    Post,
    Headers,
    Req,
    RawBodyRequest,
    Logger,
    HttpCode,
    HttpException,
    InternalServerErrorException,
} from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';

/**
 * Stripe webhook endpoint mounted at /webhook/stripe (no global prefix).
 *
 * Stripe Dashboard is configured to send events to:
 *   https://web-production-afbe4.up.railway.app/webhook/stripe
 *
 * Because the main app has a global prefix of "api/v1", the regular
 * PaymentsController endpoint lives at /api/v1/payments/webhook/stripe.
 * This controller provides the path that Stripe actually hits.
 */
@Controller('webhook')
export class StripeWebhookController {
    private readonly logger = new Logger(StripeWebhookController.name);

    constructor(private readonly paymentsService: PaymentsService) { }

    @Post('stripe')
    @HttpCode(200)
    @ApiExcludeEndpoint()
    async stripeWebhook(
        @Req() req: RawBodyRequest<any>,
        @Headers('stripe-signature') signature: string,
    ) {
        // NestJS rawBody: true stores raw body as a Buffer on req.rawBody
        const rawBody = req.rawBody
            ? (Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : req.rawBody)
            : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));

        const requestId = String(
            req.headers['x-railway-request-id'] ||
            req.headers['x-request-id'] ||
            `stripe_${Date.now()}`,
        );

        this.logger.log(
            `[StripeWebhookController] requestId=${requestId} signaturePresent=${!!signature} payloadBytes=${Buffer.byteLength(rawBody || '', 'utf8')}`,
        );

        if (!signature) {
            this.logger.warn(`[StripeWebhookController] requestId=${requestId} missing stripe-signature header`);
            return { received: false, error: 'Missing stripe-signature header', requestId };
        }

        try {
            await this.paymentsService.handleStripeWebhook(rawBody, signature, requestId);
            return { received: true, requestId };
        } catch (err) {
            if (err instanceof HttpException) {
                throw err;
            }
            this.logger.error(
                `[StripeWebhookController] requestId=${requestId} unhandled error: ${(err as Error).message}`,
                (err as Error).stack,
            );
            throw new InternalServerErrorException('Unhandled Stripe webhook controller error');
        }
    }
}

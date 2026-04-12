import { Controller, Post, Headers, Req, RawBodyRequest, Logger } from '@nestjs/common';
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
    @ApiExcludeEndpoint()
    async stripeWebhook(
        @Req() req: RawBodyRequest<any>,
        @Headers('stripe-signature') signature: string,
    ) {
        // NestJS rawBody: true stores raw body as a Buffer on req.rawBody
        const rawBody = req.rawBody
            ? (Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : req.rawBody)
            : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));

        if (!signature) {
            this.logger.warn('Stripe webhook received without signature header');
            return { received: false, error: 'Missing stripe-signature header' };
        }

        await this.paymentsService.handleStripeWebhook(rawBody, signature);
        return { received: true };
    }
}

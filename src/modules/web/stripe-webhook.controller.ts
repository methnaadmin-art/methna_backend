import {
    Controller,
    Post,
    Req,
    Logger,
    HttpCode,
    RawBodyRequest,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { Request } from 'express';
import { StripeService } from './stripe.service';

/**
 * Stripe Webhook controller.
 *
 * Mounted at /webhook/stripe (excluded from the api/v1 global prefix in main.ts).
 * Stripe Dashboard sends events here (checkout.session.completed, subscription updates).
 */
@ApiTags('webhook')
@Controller('webhook')
export class StripeWebhookController {
    private readonly logger = new Logger(StripeWebhookController.name);

    constructor(private readonly stripeService: StripeService) {}

    @Post('stripe')
    @HttpCode(200)
    @ApiExcludeEndpoint()
    async handleStripeWebhook(@Req() req: RawBodyRequest<Request>) {
        const signature = req.headers['stripe-signature'] as string;
        if (!signature) {
            this.logger.warn('[StripeWebhook] Missing stripe-signature header');
            return { received: false, error: 'Missing stripe-signature header' };
        }

        const rawBody = req.rawBody;
        if (!rawBody) {
            this.logger.warn('[StripeWebhook] Missing raw body');
            return { received: false, error: 'Missing raw body' };
        }

        try {
            await this.stripeService.handleWebhook(rawBody, signature);
            return { received: true };
        } catch (error) {
            this.logger.error(`[StripeWebhook] Error: ${(error as Error).message}`);
            return { received: false, error: (error as Error).message };
        }
    }
}

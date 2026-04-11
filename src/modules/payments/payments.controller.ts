import { Controller, Get, Post, Body, Headers, UseGuards, Request, Req, RawBodyRequest, Logger } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiBody, ApiExcludeEndpoint } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaymentsService, CreateCheckoutSessionDto, PaymentProvider } from './payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
    private readonly logger = new Logger(PaymentsController.name);

    constructor(private readonly paymentsService: PaymentsService) { }

    @Get('pricing')
    getPricing() {
        return this.paymentsService.getPricing();
    }

    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @Post('create-checkout-session')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                planCode: { type: 'string', description: 'Plan code from DB (e.g. premium, gold)' },
                provider: { type: 'string', enum: Object.values(PaymentProvider) },
            },
            required: ['planCode', 'provider'],
        },
    })
    async createCheckoutSession(@Request() req, @Body() dto: CreateCheckoutSessionDto) {
        return this.paymentsService.createCheckoutSession(req.user.id, dto);
    }

    // Legacy endpoint kept for backward compat
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @Post('create-intent')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                planCode: { type: 'string' },
                provider: { type: 'string', enum: Object.values(PaymentProvider) },
            },
            required: ['planCode', 'provider'],
        },
    })
    async createPaymentIntent(@Request() req, @Body() dto: CreateCheckoutSessionDto) {
        return this.paymentsService.createCheckoutSession(req.user.id, dto);
    }

    @Post('webhook/stripe')
    @ApiExcludeEndpoint()
    async stripeWebhook(
        @Req() req: RawBodyRequest<any>,
        @Headers('stripe-signature') signature: string,
    ) {
        const rawBody = req.rawBody ?? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));

        if (!signature) {
            this.logger.warn('Stripe webhook received without signature header');
            return { received: false, error: 'Missing stripe-signature header' };
        }

        await this.paymentsService.handleStripeWebhook(rawBody, signature);
        return { received: true };
    }
}

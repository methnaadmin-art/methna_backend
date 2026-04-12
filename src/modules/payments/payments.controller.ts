import {
    Controller,
    Get,
    Post,
    Body,
    Headers,
    UseGuards,
    Request,
    Req,
    RawBodyRequest,
    Logger,
    HttpCode,
    HttpException,
    InternalServerErrorException,
} from '@nestjs/common';
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
            `[PaymentsController] requestId=${requestId} signaturePresent=${!!signature} payloadBytes=${Buffer.byteLength(rawBody || '', 'utf8')}`,
        );

        if (!signature) {
            this.logger.warn(`[PaymentsController] requestId=${requestId} missing stripe-signature header`);
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
                `[PaymentsController] requestId=${requestId} unhandled error: ${(err as Error).message}`,
                (err as Error).stack,
            );
            throw new InternalServerErrorException('Unhandled Stripe webhook controller error');
        }
    }
}

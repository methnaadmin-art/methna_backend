import {
    Body,
    Controller,
    Get,
    Post,
    Request,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
    CreateCheckoutSessionDto,
    PaymentsService,
} from './payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
    constructor(private readonly paymentsService: PaymentsService) { }

    @Get('pricing')
    @ApiOperation({ summary: 'Get active Google Play plan catalog' })
    getPricing() {
        return this.paymentsService.getPricing();
    }

    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @Post('create-checkout-session')
    @ApiOperation({ summary: 'Legacy web checkout endpoint (disabled)' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                planCode: { type: 'string', description: 'Plan code from DB' },
                provider: { type: 'string', example: 'google_play' },
                platform: { type: 'string', example: 'android' },
            },
            required: ['planCode'],
        },
    })
    async createCheckoutSession(@Request() req, @Body() dto: CreateCheckoutSessionDto) {
        return this.paymentsService.createCheckoutSession(req.user.id, dto);
    }

    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @Post('create-intent')
    @ApiOperation({ summary: 'Legacy payment intent endpoint (disabled)' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                planCode: { type: 'string' },
                provider: { type: 'string', example: 'google_play' },
                platform: { type: 'string', example: 'android' },
            },
            required: ['planCode'],
        },
    })
    async createPaymentIntent(@Request() req, @Body() dto: CreateCheckoutSessionDto) {
        return this.paymentsService.createCheckoutSession(req.user.id, dto);
    }

    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @Get('manage-url')
    @ApiOperation({ summary: 'Get Google Play subscription management URL' })
    async getManageSubscriptionUrl(@Request() req) {
        return this.paymentsService.getSubscriptionManagementUrl(req.user.id);
    }
}

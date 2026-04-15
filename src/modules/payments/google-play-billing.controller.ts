import {
    Controller,
    Post,
    Body,
    UseGuards,
    Request,
    Logger,
    HttpCode,
    GoneException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
    VerifyPurchaseDto,
    RestorePurchaseDto,
} from './google-play-billing.service';

@ApiTags('payments')
@Controller('payments/google-play')
export class GooglePlayBillingController {
    private readonly logger = new Logger(GooglePlayBillingController.name);

    constructor() { }

    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @Post('verify')
    @HttpCode(200)
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                platform: { type: 'string', example: 'android' },
                provider: { type: 'string', example: 'google_play' },
                productId: { type: 'string', description: 'Google Play product ID (e.g. com.methnapp.app.premium_monthly)' },
                purchaseId: { type: 'string', description: 'Google Play order ID (e.g. GPA.1234...)' },
                purchaseToken: { type: 'string', description: 'Google Play purchase token from verificationData.serverVerificationData' },
                verificationData: { type: 'string', description: 'Local verification data' },
                verificationSource: { type: 'string', description: 'Verification source' },
                transactionDate: { type: 'string', description: 'Transaction timestamp in ms' },
                restored: { type: 'boolean', description: 'Whether this is a restore operation' },
            },
            required: ['productId', 'purchaseToken'],
        },
    })
    async verifyPurchase(@Request() req, @Body() dto: VerifyPurchaseDto) {
        this.logger.warn(
            `Deprecated Google Play verify endpoint called by user ${req.user.id}: productId=${dto.productId}`,
        );
        throw new GoneException(
            'Google Play checkout verification has been retired. Use Stripe checkout and Stripe webhooks for entitlement activation.',
        );
    }

    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @Post('restore')
    @HttpCode(200)
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                purchaseToken: { type: 'string' },
                productId: { type: 'string' },
            },
            required: ['purchaseToken', 'productId'],
        },
    })
    async restorePurchase(@Request() req, @Body() dto: RestorePurchaseDto) {
        this.logger.warn(
            `Deprecated Google Play restore endpoint called by user ${req.user.id}: productId=${dto.productId}`,
        );
        throw new GoneException(
            'Google Play restore is no longer supported. Subscription access is managed by Stripe checkout and webhook state.',
        );
    }
}

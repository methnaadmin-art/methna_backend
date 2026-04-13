import {
    Controller,
    Post,
    Body,
    UseGuards,
    Request,
    Logger,
    HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
    GooglePlayBillingService,
    VerifyPurchaseDto,
    RestorePurchaseDto,
} from './google-play-billing.service';

@ApiTags('payments')
@Controller('payments/google-play')
export class GooglePlayBillingController {
    private readonly logger = new Logger(GooglePlayBillingController.name);

    constructor(
        private readonly billingService: GooglePlayBillingService,
    ) { }

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
                productId: { type: 'string', description: 'Google Play product ID (e.g. com.methna.app.premium_monthly)' },
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
        this.logger.log(
            `Verify purchase for user ${req.user.id}: productId=${dto.productId}`,
        );
        return this.billingService.verifyAndActivatePurchase(req.user.id, dto);
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
        this.logger.log(
            `Restore purchase for user ${req.user.id}: productId=${dto.productId}`,
        );
        return this.billingService.restorePurchase(req.user.id, dto);
    }
}

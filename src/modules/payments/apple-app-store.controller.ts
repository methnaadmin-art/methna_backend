import {
    Body,
    Controller,
    HttpCode,
    Logger,
    Post,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
    AppleAppStoreService,
    VerifyApplePurchaseDto,
} from './apple-app-store.service';

@ApiTags('mobile')
@Controller('mobile/payments/apple')
export class AppleAppStoreController {
    private readonly logger = new Logger(AppleAppStoreController.name);

    constructor(private readonly appleAppStoreService: AppleAppStoreService) {}

    @Post('verify')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @HttpCode(200)
    @ApiOperation({ summary: 'Verify an Apple App Store subscription purchase' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                platform: { type: 'string', example: 'ios' },
                provider: { type: 'string', example: 'apple' },
                productId: {
                    type: 'string',
                    enum: [
                        'com.methnapp.app.premium_monthly',
                        'com.methnapp.app.premium_yearly',
                    ],
                },
                transactionId: { type: 'string' },
                originalTransactionId: { type: 'string' },
                purchaseToken: {
                    type: 'string',
                    description: 'verificationData.serverVerificationData, signed transaction JWS, receipt, or transaction ID',
                },
                serverVerificationData: { type: 'string' },
                verificationData: {
                    oneOf: [
                        { type: 'string' },
                        {
                            type: 'object',
                            properties: {
                                serverVerificationData: { type: 'string' },
                                localVerificationData: { type: 'string' },
                                source: { type: 'string' },
                            },
                        },
                    ],
                },
                receiptData: { type: 'string' },
                transactionDate: { type: 'string' },
                restored: { type: 'boolean' },
                environment: { type: 'string', enum: ['auto', 'production', 'sandbox'] },
            },
            required: ['productId'],
        },
    })
    async verifyPurchase(
        @CurrentUser('sub') userId: string,
        @Body() dto: VerifyApplePurchaseDto,
    ) {
        this.logger.log(
            `[PAYMENT] Apple verify called user=${userId} productId=${dto.productId}`,
        );
        return this.appleAppStoreService.verifyAndActivatePurchase(userId, dto);
    }
}

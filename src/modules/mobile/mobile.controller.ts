import {
    BadRequestException,
    Controller,
    Get,
    Post,
    Body,
    UseGuards,
    Request,
    HttpCode,
    Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlansService } from '../plans/plans.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import {
    GooglePlayBillingService,
    VerifyPurchaseDto,
    RestorePurchaseDto,
} from '../payments/google-play-billing.service';
import { ConsumableService } from '../consumables/consumable.service';

/**
 * Mobile API surface — Google Play Billing ONLY.
 *
 * This controller exposes:
 *   GET  /mobile/plans                          — active plans with Google Play fields only
 *   GET  /mobile/subscription/me                — current user subscription + entitlements
 *   POST /mobile/payments/google-play/verify     — verify a Google Play purchase
 *   POST /mobile/payments/google-play/restore    — restore a Google Play purchase
 *
 * No Stripe fields, no Stripe logic.
 */
@ApiTags('mobile')
@Controller('mobile')
export class MobileController {
    private readonly logger = new Logger(MobileController.name);

    constructor(
        private readonly plansService: PlansService,
        private readonly subscriptionsService: SubscriptionsService,
        private readonly googlePlayBillingService: GooglePlayBillingService,
        private readonly consumableService: ConsumableService,
    ) {}

    // ─── Plans (public, no auth) ─────────────────────────────

    @Get('plans')
    @ApiOperation({ summary: 'Get active plans for mobile app (Google Play fields only)' })
    async getMobilePlans() {
        const plans = await this.plansService.getPublicPlans();
        return plans.map((plan) => ({
            id: plan.id,
            code: plan.code,
            name: plan.name,
            description: plan.description,
            price: Number(plan.price),
            currency: plan.currency,
            billingCycle: plan.billingCycle,
            durationDays: plan.durationDays,
            googleProductId: plan.googleProductId,
            googleBasePlanId: plan.googleBasePlanId,
            features: plan.featureFlags || {},
            limits: plan.limits || {},
            entitlements: plan.entitlements || {},
            isActive: plan.isActive,
            sortOrder: plan.sortOrder,
        }));
    }

    // ─── Subscription status (authenticated) ─────────────────

    @Get('subscription/me')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get current user subscription and entitlements (mobile)' })
    async getMySubscription(@CurrentUser('sub') userId: string) {
        const [subscription, entitlementData] = await Promise.all([
            this.subscriptionsService.getMySubscription(userId),
            this.plansService.resolveUserEntitlements(userId),
        ]);

        return {
            id: subscription.id,
            plan: subscription.planEntity?.code ?? subscription.plan ?? 'free',
            planId: subscription.planId,
            status: subscription.status,
            startDate: subscription.startDate,
            endDate: subscription.endDate,
            paymentProvider: subscription.paymentProvider,
            googleProductId: subscription.googleProductId,
            googleOrderId: subscription.googleOrderId,
            billingCycle: subscription.billingCycle,
            entitlements: entitlementData.entitlements,
            planEntity: entitlementData.plan
                ? {
                      id: entitlementData.plan.id,
                      code: entitlementData.plan.code,
                      name: entitlementData.plan.name,
                      features: entitlementData.plan.featureFlags || {},
                      limits: entitlementData.plan.limits || {},
                  }
                : null,
        };
    }

    // ─── Google Play Billing: Verify ─────────────────────────

    @Post('payments/google-play/verify')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @HttpCode(200)
    @ApiOperation({ summary: 'Verify a Google Play purchase (mobile only)' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                platform: { type: 'string', example: 'android' },
                provider: { type: 'string', example: 'google_play' },
                productId: { type: 'string', description: 'Google Play product ID' },
                basePlanId: { type: 'string', description: 'Google Play base plan ID (optional)' },
                purchaseId: { type: 'string', description: 'Google Play order ID' },
                purchaseToken: { type: 'string', description: 'Google Play purchase token' },
                verificationData: { type: 'string' },
                verificationSource: { type: 'string' },
                transactionDate: { type: 'string' },
                restored: { type: 'boolean' },
            },
            required: ['productId', 'purchaseToken'],
        },
    })
    async verifyPurchase(@Request() req, @Body() dto: VerifyPurchaseDto) {
        this.logger.log(
            `[PAYMENT] Mobile verify called user=${req.user.id} productId=${dto.productId}`,
        );
        return this.googlePlayBillingService.verifyAndActivatePurchase(req.user.id, dto);
    }

    // ─── Google Play Billing: Restore ────────────────────────

    @Post('payments/google-play/restore')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @HttpCode(200)
    @ApiOperation({ summary: 'Restore a Google Play purchase (mobile only)' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                purchaseToken: { type: 'string' },
                productId: { type: 'string' },
                basePlanId: { type: 'string' },
            },
            required: ['purchaseToken', 'productId'],
        },
    })
    async restorePurchase(@Request() req, @Body() dto: RestorePurchaseDto) {
        this.logger.log(
            `[PAYMENT] Mobile restore called user=${req.user.id} productId=${dto.productId}`,
        );
        return this.googlePlayBillingService.restorePurchase(req.user.id, dto);
    }

    // ─── Consumable Products (public, no auth) ────────────────

    @Get('consumables')
    @ApiOperation({ summary: 'Get active consumable products for mobile (Google Play fields only)' })
    async getMobileConsumables() {
        const products = await this.consumableService.getProducts('mobile');
        return products.map((p) => ({
            id: p.id,
            code: p.code,
            title: p.title,
            description: p.description,
            type: p.type,
            quantity: p.quantity,
            price: Number(p.price),
            currency: p.currency,
            googleProductId: p.googleProductId,
            sortOrder: p.sortOrder,
        }));
    }

    // ─── Consumable Balances (authenticated) ──────────────────

    @Get('consumables/balances')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get current user consumable balances (mobile)' })
    async getMyConsumableBalances(@CurrentUser('sub') userId: string) {
        return this.consumableService.getUserBalances(userId);
    }

    // ─── Google Play Consumable: Verify ──────────────────────

    @Post('consumables/google-play/verify')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @HttpCode(200)
    @ApiOperation({ summary: 'Verify a Google Play consumable purchase and grant balance' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                productId: { type: 'string', description: 'Google Play consumable product ID' },
                purchaseToken: { type: 'string', description: 'Google Play purchase token' },
                orderId: { type: 'string', description: 'Google Play order ID' },
                transactionDate: { type: 'string' },
            },
            required: ['productId', 'purchaseToken'],
        },
    })
    async verifyConsumablePurchase(
        @Request() req,
        @Body() dto: { productId: string; purchaseToken: string; orderId?: string; transactionDate?: string },
    ) {
        const userId = req.user.id;
        this.logger.log(
            `[PAYMENT] Mobile consumable verify called user=${userId} productId=${dto.productId}`,
        );

        // Resolve consumable product by Google Play product ID
        const product = await this.consumableService.findByGoogleProductId(dto.productId);
        if (!product) {
            throw new BadRequestException(
                `No active consumable product mapped to Google Play ID '${dto.productId}'`,
            );
        }

        // Use the existing Google Play verification infrastructure
        const verificationResult = await this.googlePlayBillingService.verifyAndActivateConsumablePurchase(
            userId,
            product.id,
            {
                platform: 'android',
                provider: 'google_play',
                productId: dto.productId,
                purchaseToken: dto.purchaseToken,
                purchaseId: dto.orderId,
                transactionDate: dto.transactionDate,
            },
        );

        // Grant balance after verification
        const balances = await this.consumableService.grantBalance(
            userId,
            product.id,
            'google_play' as any,
            dto.purchaseToken,
            dto.orderId,
            verificationResult.rawVerification,
            verificationResult.transactionDate ? new Date(verificationResult.transactionDate) : undefined,
        );

        return {
            status: 'verified',
            provider: 'google_play',
            product: {
                id: product.id,
                code: product.code,
                title: product.title,
                type: product.type,
                quantity: product.quantity,
            },
            balances,
        };
    }

    // ─── Consumable Purchase History (authenticated) ─────────

    @Get('consumables/purchases')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get consumable purchase history (mobile)' })
    async getMyConsumablePurchases(@CurrentUser('sub') userId: string) {
        return this.consumableService.getPurchaseHistory(userId);
    }
}

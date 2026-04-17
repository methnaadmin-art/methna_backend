import {
    Controller,
    Get,
    Post,
    Body,
    UseGuards,
    Logger,
    HttpCode,
    Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiBody, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlansService } from '../plans/plans.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { StripeService } from './stripe.service';
import { ConsumableService } from '../consumables/consumable.service';

/**
 * Website API surface — Stripe ONLY.
 *
 * This controller exposes:
 *   GET  /web/plans                             — active plans with Stripe fields only
 *   GET  /web/subscription/status               — current user subscription status
 *   GET  /web/subscription/status-by-email      — subscription status by email (public)
 *   POST /web/payments/create-checkout-session   — create a Stripe checkout session
 *   POST /web/subscriptions/check-email          — check if email exists before checkout
 *   POST /web/subscription/manage                — get Stripe manage URL by email (public)
 *   GET  /web/payments/manage-url                — get Stripe subscription management URL
 *
 * No Google Play fields, no Google billing logic.
 */
@ApiTags('web')
@Controller('web')
export class WebController {
    private readonly logger = new Logger(WebController.name);

    constructor(
        private readonly plansService: PlansService,
        private readonly subscriptionsService: SubscriptionsService,
        private readonly stripeService: StripeService,
        private readonly consumableService: ConsumableService,
    ) {}

    // ─── Plans (public, no auth) ─────────────────────────────

    @Get('plans')
    @ApiOperation({ summary: 'Get active plans for website (Stripe fields only)' })
    async getWebPlans() {
        const plans = await this.plansService.getPublicPlans();
        return plans
            .filter((plan) => !!plan.stripePriceId)
            .map((plan) => ({
                id: plan.id,
                code: plan.code,
                name: plan.name,
                description: plan.description,
                price: Number(plan.price),
                currency: plan.currency,
                billingCycle: plan.billingCycle,
                durationDays: plan.durationDays,
                stripePriceId: plan.stripePriceId,
                stripeProductId: plan.stripeProductId,
                features: plan.featureFlags || {},
                limits: plan.limits || {},
                entitlements: plan.entitlements || {},
                isActive: plan.isActive,
                sortOrder: plan.sortOrder,
            }));
    }

    // ─── Email check (public) ────────────────────────────────

    @Post('subscriptions/check-email')
    @HttpCode(200)
    @ApiOperation({ summary: 'Check if email exists before Stripe checkout' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                email: { type: 'string', format: 'email' },
            },
            required: ['email'],
        },
    })
    async checkEmail(@Body('email') email: string) {
        if (!email || typeof email !== 'string') {
            return { exists: false };
        }
        return this.stripeService.checkUserEmail(email.trim().toLowerCase());
    }

    // ─── Subscription status by email (public) ─────────────

    @Get('subscription/status-by-email')
    @HttpCode(200)
    @ApiOperation({ summary: 'Get subscription status by account email (public)' })
    @ApiQuery({ name: 'email', required: true, type: String })
    async getSubscriptionStatusByEmail(@Query('email') email: string) {
        if (!email || typeof email !== 'string') {
            return {
                exists: false,
                message: 'Valid account email is required.',
            };
        }

        return this.stripeService.getSubscriptionStatusByEmail(email.trim().toLowerCase());
    }

    // ─── Stripe Checkout Session (authenticated) ────────────

    @Post('payments/create-checkout-session')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @HttpCode(200)
    @ApiOperation({ summary: 'Create a Stripe checkout session (website, authenticated)' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                planCode: { type: 'string', description: 'Plan code (e.g. premium, gold)' },
            },
            required: ['planCode'],
        },
    })
    async createCheckoutSession(
        @CurrentUser('sub') userId: string,
        @Body('planCode') planCode: string,
    ) {
        this.logger.log(
            `[Web] Stripe checkout requested: user=${userId} plan=${planCode}`,
        );
        return this.stripeService.createCheckoutSession(userId, planCode);
    }

    // ─── Stripe Checkout Session (public, email-based) ───────

    @Post('payments/public-checkout')
    @HttpCode(200)
    @ApiOperation({ summary: 'Create a Stripe checkout session using email (no JWT required)' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                email: { type: 'string', format: 'email', description: 'User email (must exist in app)' },
                planCode: { type: 'string', description: 'Plan code (e.g. premium, gold)' },
                successUrl: { type: 'string', description: 'URL to redirect after success' },
                cancelUrl: { type: 'string', description: 'URL to redirect after cancel' },
            },
            required: ['email', 'planCode'],
        },
    })
    async publicCheckout(
        @Body('email') email: string,
        @Body('planCode') planCode: string,
        @Body('successUrl') successUrl?: string,
        @Body('cancelUrl') cancelUrl?: string,
    ) {
        this.logger.log(`[Web] Public checkout requested: email=${email} plan=${planCode}`);
        return this.stripeService.createPublicCheckoutSession(email, planCode, successUrl, cancelUrl);
    }

    // ─── Subscription status (authenticated) ─────────────────

    @Get('subscription/status')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get current user subscription status (website)' })
    async getSubscriptionStatus(@CurrentUser('sub') userId: string) {
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
            stripeSubscriptionId: subscription.stripeSubscriptionId,
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

    // ─── Subscription management URL by email (public) ─────

    @Post('subscription/manage')
    @HttpCode(200)
    @ApiOperation({ summary: 'Get Stripe subscription management URL using account email (public)' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                email: { type: 'string', format: 'email' },
            },
            required: ['email'],
        },
    })
    async getManageUrlByEmail(@Body('email') email: string) {
        if (!email || typeof email !== 'string') {
            return {
                message: 'Valid account email is required.',
            };
        }

        const url = await this.stripeService.getManagementUrlByEmail(email.trim().toLowerCase());
        return { url, provider: 'stripe' };
    }

    // ─── Subscription management URL ─────────────────────────

    @Get('payments/manage-url')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get Stripe subscription management URL' })
    async getManageUrl(@CurrentUser('sub') userId: string) {
        const url = await this.stripeService.getManagementUrl(userId);
        return { url, provider: 'stripe' };
    }

    // ─── Consumable Products (public, no auth) ────────────────

    @Get('consumables')
    @ApiOperation({ summary: 'Get active consumable products for web (Stripe fields only)' })
    async getWebConsumables() {
        const products = await this.consumableService.getProducts('web');
        return products.map((p) => ({
            id: p.id,
            code: p.code,
            title: p.title,
            description: p.description,
            type: p.type,
            quantity: p.quantity,
            price: Number(p.price),
            currency: p.currency,
            stripePriceId: p.stripePriceId,
            sortOrder: p.sortOrder,
        }));
    }

    // ─── Consumable Balances (authenticated) ──────────────────

    @Get('consumables/balances')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get current user consumable balances (web)' })
    async getMyConsumableBalances(@CurrentUser('sub') userId: string) {
        return this.consumableService.getUserBalances(userId);
    }

    // ─── Stripe Consumable Checkout ───────────────────────────

    @Post('consumables/create-checkout-session')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @HttpCode(200)
    @ApiOperation({ summary: 'Create a Stripe checkout session for a consumable product (website only)' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                productCode: { type: 'string', description: 'Consumable product code (e.g. likes_10)' },
            },
            required: ['productCode'],
        },
    })
    async createConsumableCheckoutSession(
        @CurrentUser('sub') userId: string,
        @Body('productCode') productCode: string,
    ) {
        this.logger.log(
            `[Web] Stripe consumable checkout requested: user=${userId} product=${productCode}`,
        );
        return this.stripeService.createConsumableCheckoutSession(userId, productCode);
    }

    // ─── Consumable Purchase History (authenticated) ─────────

    @Get('consumables/purchases')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get consumable purchase history (web)' })
    async getMyConsumablePurchases(@CurrentUser('sub') userId: string) {
        return this.consumableService.getPurchaseHistory(userId);
    }
}

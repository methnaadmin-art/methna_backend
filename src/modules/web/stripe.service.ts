import {
    BadRequestException,
    Injectable,
    Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import Stripe from 'stripe';
import { Plan } from '../../database/entities/plan.entity';
import { ConsumableProduct } from '../../database/entities/consumable-product.entity';
import {
    Subscription,
    SubscriptionStatus,
} from '../../database/entities/subscription.entity';
import {
    PurchaseProvider,
    PurchaseStatus,
    PurchaseTransaction,
} from '../../database/entities/purchase-transaction.entity';
import { User } from '../../database/entities/user.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

@Injectable()
export class StripeService {
    private readonly logger = new Logger(StripeService.name);
    private stripe: Stripe | null = null;
    private webhookSecret: string;

    constructor(
        private readonly configService: ConfigService,
        @InjectRepository(Plan)
        private readonly planRepo: Repository<Plan>,
        @InjectRepository(ConsumableProduct)
        private readonly consumableProductRepo: Repository<ConsumableProduct>,
        @InjectRepository(Subscription)
        private readonly subscriptionRepo: Repository<Subscription>,
        @InjectRepository(PurchaseTransaction)
        private readonly purchaseRepo: Repository<PurchaseTransaction>,
        @InjectRepository(User)
        private readonly userRepo: Repository<User>,
        private readonly subscriptionsService: SubscriptionsService,
        private readonly dataSource: DataSource,
    ) {
        this.initStripe();
    }

    // ─── Public API ──────────────────────────────────────────

    /** Create a Stripe Checkout session for a given plan. */
    async createCheckoutSession(
        userId: string,
        planCode: string,
    ): Promise<{ checkoutUrl: string; sessionId: string }> {
        if (!this.stripe) {
            throw new BadRequestException('Stripe is not configured on this server.');
        }

        const plan = await this.resolveStripePlan(planCode);
        const user = await this.userRepo.findOne({ where: { id: userId }, select: ['id', 'email'] });
        if (!user) {
            throw new BadRequestException('User not found.');
        }

        const successUrl =
            this.configService.get<string>('stripe.successUrl') ||
            this.configService.get<string>('STRIPE_SUCCESS_URL') ||
            'https://methna.app/payment-success?session_id={CHECKOUT_SESSION_ID}';

        const cancelUrl =
            this.configService.get<string>('stripe.cancelUrl') ||
            this.configService.get<string>('STRIPE_CANCEL_URL') ||
            'https://methna.app/payment-cancel';

        const session = await this.stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            line_items: [
                {
                    price: plan.stripePriceId!,
                    quantity: 1,
                },
            ],
            customer_email: user.email,
            client_reference_id: userId,
            metadata: {
                userId,
                planId: plan.id,
                planCode: plan.code,
            },
            success_url: successUrl,
            cancel_url: cancelUrl,
        });

        this.logger.log(
            `[Stripe] Checkout session created: session=${session.id} plan=${plan.code} user=${userId}`,
        );

        return {
            checkoutUrl: session.url!,
            sessionId: session.id,
        };
    }

    /** Create a Stripe Checkout session using email (public, no JWT). */
    async createPublicCheckoutSession(
        email: string,
        planCode: string,
        successUrl?: string,
        cancelUrl?: string,
    ): Promise<{ checkoutUrl: string; sessionId: string }> {
        if (!this.stripe) {
            throw new BadRequestException('Stripe is not configured on this server.');
        }

        const user = await this.userRepo.findOne({
            where: { email: email.trim().toLowerCase() },
            select: ['id', 'email'],
        });
        if (!user) {
            throw new BadRequestException('No account found with this email. Please install the app and create an account first.');
        }

        const eligibility = await this.checkUserEmail(user.email);
        if (eligibility.isPremium) {
            const activePlan = eligibility.planCode ? ` (${eligibility.planCode})` : '';
            throw new BadRequestException(
                `This account already has an active premium subscription${activePlan}. Manage your billing instead of creating a new checkout.`,
            );
        }

        const plan = await this.resolveStripePlan(planCode);

        const finalSuccessUrl =
            successUrl ||
            this.configService.get<string>('STRIPE_SUCCESS_URL') ||
            'https://methna.app/payment-success?session_id={CHECKOUT_SESSION_ID}';

        const finalCancelUrl =
            cancelUrl ||
            this.configService.get<string>('STRIPE_CANCEL_URL') ||
            'https://methna.app/payment-cancel';

        const session = await this.stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            line_items: [
                {
                    price: plan.stripePriceId!,
                    quantity: 1,
                },
            ],
            customer_email: user.email,
            client_reference_id: user.id,
            metadata: {
                userId: user.id,
                planId: plan.id,
                planCode: plan.code,
            },
            success_url: finalSuccessUrl,
            cancel_url: finalCancelUrl,
        });

        this.logger.log(
            `[Stripe] Public checkout session created: session=${session.id} plan=${plan.code} email=${email}`,
        );

        return {
            checkoutUrl: session.url!,
            sessionId: session.id,
        };
    }

    /** Create a Stripe Checkout session for a consumable product (one-time payment). */
    async createConsumableCheckoutSession(
        userId: string,
        productCode: string,
    ): Promise<{ checkoutUrl: string; sessionId: string }> {
        if (!this.stripe) {
            throw new BadRequestException('Stripe is not configured on this server.');
        }

        const product = await this.consumableProductRepo.findOne({
            where: { code: productCode, isActive: true, isArchived: false },
        });
        if (!product) {
            throw new BadRequestException(`No active consumable product found with code '${productCode}'.`);
        }
        if (!product.stripePriceId) {
            throw new BadRequestException(
                `Consumable product '${productCode}' does not have a Stripe price ID configured.`,
            );
        }

        const user = await this.userRepo.findOne({ where: { id: userId }, select: ['id', 'email'] });
        if (!user) {
            throw new BadRequestException('User not found.');
        }

        const successUrl =
            this.configService.get<string>('stripe.successUrl') ||
            this.configService.get<string>('STRIPE_SUCCESS_URL') ||
            'https://methna.app/payment-success?session_id={CHECKOUT_SESSION_ID}';

        const cancelUrl =
            this.configService.get<string>('stripe.cancelUrl') ||
            this.configService.get<string>('STRIPE_CANCEL_URL') ||
            'https://methna.app/payment-cancel';

        const session = await this.stripe.checkout.sessions.create({
            mode: 'payment', // one-time payment, not subscription
            payment_method_types: ['card'],
            line_items: [
                {
                    price: product.stripePriceId,
                    quantity: 1,
                },
            ],
            customer_email: user.email,
            client_reference_id: userId,
            metadata: {
                userId,
                consumableProductId: product.id,
                consumableProductCode: product.code,
                purchaseType: 'consumable',
            },
            success_url: successUrl,
            cancel_url: cancelUrl,
        });

        this.logger.log(
            `[Stripe] Consumable checkout session created: session=${session.id} product=${product.code} user=${userId}`,
        );

        return {
            checkoutUrl: session.url!,
            sessionId: session.id,
        };
    }

    /** Handle Stripe webhook events (checkout.session.completed, etc.) */
    async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
        if (!this.stripe) {
            throw new BadRequestException('Stripe is not configured on this server.');
        }

        let event: Stripe.Event;
        try {
            event = this.stripe.webhooks.constructEvent(
                rawBody,
                signature,
                this.webhookSecret,
            );
        } catch (err) {
            this.logger.error(`[Stripe] Webhook signature verification failed: ${(err as Error).message}`);
            throw new BadRequestException('Invalid Stripe webhook signature.');
        }

        this.logger.log(`[Stripe] Webhook received: type=${event.type} id=${event.id}`);

        switch (event.type) {
            case 'checkout.session.completed':
                await this.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
                break;
            case 'customer.subscription.updated':
            case 'customer.subscription.deleted':
                await this.handleSubscriptionChange(event.data.object as Stripe.Subscription);
                break;
            default:
                this.logger.log(`[Stripe] Unhandled event type: ${event.type}`);
        }
    }

    /** Get subscription management portal URL for a user. */
    async getManagementUrl(userId: string): Promise<string> {
        const subscription = await this.subscriptionRepo.findOne({
            where: [
                { userId, status: SubscriptionStatus.ACTIVE, paymentProvider: 'stripe' },
                { userId, status: SubscriptionStatus.PENDING_CANCELLATION, paymentProvider: 'stripe' },
                { userId, status: SubscriptionStatus.PAST_DUE, paymentProvider: 'stripe' },
            ],
            order: { updatedAt: 'DESC' },
        });

        if (!subscription?.stripeCustomerId && this.stripe) {
            // Fallback to Stripe billing portal
            const managementUrl =
                this.configService.get<string>('stripe.managementUrl') ||
                this.configService.get<string>('STRIPE_MANAGEMENT_URL') ||
                'https://billing.stripe.com/p/login';
            return managementUrl;
        }

        if (this.stripe && subscription?.stripeCustomerId) {
            try {
                const session = await this.stripe.billingPortal.sessions.create({
                    customer: subscription.stripeCustomerId,
                    return_url: this.configService.get<string>('FRONTEND_URL') || 'https://methna.app',
                });
                return session.url;
            } catch (err) {
                this.logger.error(`[Stripe] Failed to create portal session: ${(err as Error).message}`);
            }
        }

        return (
            this.configService.get<string>('stripe.managementUrl') ||
            'https://billing.stripe.com/p/login'
        );
    }

    /** Check if a user email exists (for website pre-checkout validation). */
    async checkUserEmail(email: string): Promise<{
        exists: boolean;
        userId?: string;
        isPremium?: boolean;
        planCode?: string;
        status?: string;
        message?: string;
    }> {
        const normalizedEmail = email.trim().toLowerCase();

        const user = await this.userRepo.findOne({
            where: { email: normalizedEmail },
            select: ['id', 'email'],
        });

        if (!user) {
            return {
                exists: false,
                message: 'No account found with this email. Please install the app and create an account first.',
            };
        }

        const premiumState = await this.subscriptionsService.syncUserPremiumState(user.id);
        const activeSubscription = await this.subscriptionRepo.findOne({
            where: [
                { userId: user.id, status: SubscriptionStatus.ACTIVE },
                { userId: user.id, status: SubscriptionStatus.PENDING_CANCELLATION },
                { userId: user.id, status: SubscriptionStatus.PAST_DUE },
                { userId: user.id, status: SubscriptionStatus.TRIAL },
            ],
            order: { endDate: 'DESC', createdAt: 'DESC' },
            relations: ['planEntity'],
        });

        const planCode = activeSubscription?.planEntity?.code ?? activeSubscription?.plan ?? 'free';

        return {
            exists: true,
            userId: user.id,
            isPremium: premiumState.isPremium,
            planCode,
            status: activeSubscription?.status,
            message: premiumState.isPremium
                ? 'This account already has an active premium subscription. Open manage billing instead.'
                : 'Account found. You can continue to checkout.',
        };
    }

    async getSubscriptionStatusByEmail(email: string): Promise<{
        exists: boolean;
        planName?: string;
        planCode?: string;
        status?: string;
        renewalDate?: Date | null;
        features?: string[];
        isPremium?: boolean;
        message?: string;
    }> {
        const normalizedEmail = email.trim().toLowerCase();
        const user = await this.userRepo.findOne({
            where: { email: normalizedEmail },
            select: ['id', 'email'],
        });

        if (!user) {
            return {
                exists: false,
                message: 'No account found with this email.',
            };
        }

        const premiumState = await this.subscriptionsService.syncUserPremiumState(user.id);
        const subscription = await this.subscriptionsService.getMySubscription(user.id);

        const planCode = subscription.planEntity?.code ?? subscription.plan ?? 'free';
        const planName = subscription.planEntity?.name ?? planCode;
        const featureFlags = subscription.planEntity?.featureFlags || {};

        const features = Object.entries(featureFlags)
            .filter(([, enabled]) => enabled === true)
            .map(([feature]) => feature);

        return {
            exists: true,
            planName,
            planCode,
            status: subscription.status,
            renewalDate: subscription.endDate ?? null,
            features,
            isPremium: premiumState.isPremium,
            message: premiumState.isPremium
                ? 'Premium subscription is active.'
                : 'No active premium subscription found for this account.',
        };
    }

    async getManagementUrlByEmail(email: string): Promise<string> {
        const normalizedEmail = email.trim().toLowerCase();
        const user = await this.userRepo.findOne({
            where: { email: normalizedEmail },
            select: ['id', 'email'],
        });

        if (!user) {
            throw new BadRequestException('No account found with this email.');
        }

        return this.getManagementUrl(user.id);
    }

    // ─── Webhook handlers ────────────────────────────────────

    private async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
        const userId = session.client_reference_id || session.metadata?.userId;
        const purchaseType = session.metadata?.purchaseType;

        if (!userId) {
            this.logger.warn('[Stripe] checkout.session.completed missing userId in metadata');
            return;
        }

        // Handle consumable (one-time) purchases
        if (purchaseType === 'consumable' || session.mode === 'payment') {
            await this.handleConsumableCheckoutCompleted(session, userId);
            return;
        }

        // Handle subscription purchases
        const planId = session.metadata?.planId;
        const planCode = session.metadata?.planCode;

        let plan: Plan | null = null;
        if (planId) {
            plan = await this.planRepo.findOne({ where: { id: planId } });
        }
        if (!plan && planCode) {
            plan = await this.planRepo.findOne({ where: { code: planCode } });
        }
        if (!plan && session.subscription) {
            // Try to resolve from Stripe subscription's price -> our stripePriceId
            try {
                const stripeSub = await this.stripe!.subscriptions.retrieve(session.subscription as string);
                const priceId = stripeSub.items?.data?.[0]?.price?.id;
                if (priceId) {
                    plan = await this.planRepo.findOne({ where: { stripePriceId: priceId, isActive: true } });
                }
            } catch (err) {
                this.logger.error(`[Stripe] Failed to retrieve subscription: ${(err as Error).message}`);
            }
        }

        if (!plan) {
            this.logger.warn(
                `[Stripe] checkout.session.completed: no matching plan found. session=${session.id}`,
            );
            return;
        }

        const stripeSubscriptionId = typeof session.subscription === 'string'
            ? session.subscription
            : (session.subscription as any)?.id ?? null;
        const stripeCustomerId = typeof session.customer === 'string'
            ? session.customer
            : (session.customer as any)?.id ?? null;

        await this.activateSubscription(userId, plan, {
            stripeCheckoutSessionId: session.id,
            stripeSubscriptionId,
            stripeCustomerId,
        });

        this.logger.log(
            `[Stripe] Subscription activated: user=${userId} plan=${plan.code} session=${session.id}`,
        );
    }

    private async handleSubscriptionChange(stripeSub: Stripe.Subscription): Promise<void> {
        const stripeSubId = stripeSub.id;

        const subscription = await this.subscriptionRepo.findOne({
            where: { stripeSubscriptionId: stripeSubId },
            relations: ['planEntity'],
        });

        if (!subscription) {
            this.logger.warn(
                `[Stripe] subscription change event for unknown stripeSubscriptionId=${stripeSubId}`,
            );
            return;
        }

        const stripeStatus = stripeSub.status;
        const cancelAtPeriodEnd = (stripeSub as any).cancel_at_period_end === true;
        let newStatus: SubscriptionStatus;

        switch (stripeStatus) {
            case 'active':
                // If Stripe says cancel_at_period_end, the subscription is still
                // active but won't renew → map to PENDING_CANCELLATION.
                newStatus = cancelAtPeriodEnd
                    ? SubscriptionStatus.PENDING_CANCELLATION
                    : SubscriptionStatus.ACTIVE;
                break;
            case 'trialing':
                newStatus = SubscriptionStatus.ACTIVE;
                break;
            case 'past_due':
                newStatus = SubscriptionStatus.PAST_DUE;
                break;
            case 'canceled':
            case 'unpaid':
                newStatus = SubscriptionStatus.CANCELLED;
                break;
            default:
                newStatus = SubscriptionStatus.EXPIRED;
        }

        subscription.status = newStatus;
        if ((stripeSub as any).current_period_end) {
            subscription.endDate = new Date((stripeSub as any).current_period_end * 1000);
        }
        await this.subscriptionRepo.save(subscription);
        await this.subscriptionsService.syncUserPremiumState(subscription.userId);

        this.logger.log(
            `[Stripe] Subscription updated: user=${subscription.userId} status=${newStatus} stripeStatus=${stripeStatus}`,
        );
    }

    // ─── Helpers ─────────────────────────────────────────────

    private async handleConsumableCheckoutCompleted(session: Stripe.Checkout.Session, userId: string): Promise<void> {
        const consumableProductId = session.metadata?.consumableProductId;
        const consumableProductCode = session.metadata?.consumableProductCode;

        if (!consumableProductId && !consumableProductCode) {
            this.logger.warn(
                `[Stripe] Consumable checkout completed but no consumableProductId in metadata. session=${session.id}`,
            );
            return;
        }

        let product: ConsumableProduct | null = null;
        if (consumableProductId) {
            product = await this.consumableProductRepo.findOne({ where: { id: consumableProductId } });
        }
        if (!product && consumableProductCode) {
            product = await this.consumableProductRepo.findOne({ where: { code: consumableProductCode } });
        }

        if (!product) {
            this.logger.warn(
                `[Stripe] Consumable checkout completed but product not found. productId=${consumableProductId} session=${session.id}`,
            );
            return;
        }

        // Record purchase and grant balance
        const purchaseToken = session.id; // Stripe checkout session ID as unique token
        const existing = await this.purchaseRepo.findOne({ where: { purchaseToken } });

        if (existing?.status === PurchaseStatus.VERIFIED) {
            this.logger.log(
                `[Stripe] Consumable purchase already processed: session=${session.id} product=${product.code}`,
            );
            return;
        }

        const now = new Date();
        const purchase = existing || this.purchaseRepo.create({
            userId,
            consumableProductId: product.id,
            provider: PurchaseProvider.STRIPE,
            purchaseToken,
            productId: product.stripePriceId,
            orderId: session.payment_intent as string || null,
            status: PurchaseStatus.VERIFIED,
            rawVerification: {
                verifiedAt: now.toISOString(),
                purchaseType: 'consumable',
                stripeCheckoutSessionId: session.id,
                stripePaymentIntentId: session.payment_intent,
                stripeCustomerId: session.customer,
            },
            transactionDate: now,
            expiryDate: null,
            paymentReference: null,
        });

        purchase.status = PurchaseStatus.VERIFIED;
        await this.purchaseRepo.save(purchase);

        // Grant the balance
        const balanceField = this.getBalanceField(product.type);
        await this.userRepo.increment({ id: userId }, balanceField, product.quantity);

        this.logger.log(
            `[Stripe] Consumable balance granted: user=${userId} product=${product.code} +${product.quantity} ${product.type}`,
        );
    }

    private getBalanceField(type: string): string {
        switch (type) {
            case 'likes_pack': return 'likesBalance';
            case 'compliments_pack': return 'complimentsBalance';
            case 'boosts_pack': return 'boostsBalance';
            default: return 'likesBalance';
        }
    }

    private async resolveStripePlan(planCode: string): Promise<Plan> {
        const plan = await this.planRepo.findOne({
            where: { code: planCode, isActive: true },
        });

        if (!plan) {
            throw new BadRequestException(`No active plan found with code '${planCode}'.`);
        }

        if (!plan.stripePriceId) {
            throw new BadRequestException(
                `Plan '${planCode}' does not have a Stripe price ID configured. Contact support.`,
            );
        }

        return plan;
    }

    private async activateSubscription(
        userId: string,
        plan: Plan,
        stripeData: {
            stripeCheckoutSessionId: string;
            stripeSubscriptionId: string | null;
            stripeCustomerId: string | null;
        },
    ): Promise<void> {
        const now = new Date();
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + (plan.durationDays || 30));

        await this.dataSource.transaction(async (manager) => {
            const subscriptionRepository = manager.getRepository(Subscription);
            const purchaseRepository = manager.getRepository(PurchaseTransaction);

            // Cancel existing active subscriptions
            await subscriptionRepository.update(
                { userId, status: SubscriptionStatus.ACTIVE },
                { status: SubscriptionStatus.CANCELLED },
            );
            await subscriptionRepository.update(
                { userId, status: SubscriptionStatus.PENDING_CANCELLATION },
                { status: SubscriptionStatus.CANCELLED },
            );
            await subscriptionRepository.update(
                { userId, status: SubscriptionStatus.PAST_DUE },
                { status: SubscriptionStatus.CANCELLED },
            );
            await subscriptionRepository.update(
                { userId, status: SubscriptionStatus.TRIAL },
                { status: SubscriptionStatus.CANCELLED },
            );

            // Record purchase transaction
            const purchase = purchaseRepository.create({
                userId,
                planId: plan.id,
                provider: PurchaseProvider.STRIPE,
                purchaseToken: stripeData.stripeCheckoutSessionId,
                productId: plan.stripePriceId,
                orderId: stripeData.stripeSubscriptionId,
                status: PurchaseStatus.VERIFIED,
                rawVerification: {
                    verifiedAt: now.toISOString(),
                    stripeCheckoutSessionId: stripeData.stripeCheckoutSessionId,
                    stripeSubscriptionId: stripeData.stripeSubscriptionId,
                    stripeCustomerId: stripeData.stripeCustomerId,
                },
                transactionDate: now,
                expiryDate: endDate,
                paymentReference: null,
            });
            const savedPurchase = await purchaseRepository.save(purchase);

            // Create new subscription
            const subscription = subscriptionRepository.create({
                userId,
                plan: plan.code,
                planId: plan.id,
                planEntity: plan,
                status: SubscriptionStatus.ACTIVE,
                startDate: now,
                endDate,
                paymentReference: savedPurchase.id,
                paymentProvider: 'stripe',
                stripeSubscriptionId: stripeData.stripeSubscriptionId,
                stripeCheckoutSessionId: stripeData.stripeCheckoutSessionId,
                stripeCustomerId: stripeData.stripeCustomerId,
                googleProductId: null,
                googlePurchaseToken: null,
                googleOrderId: null,
                billingCycle: plan.billingCycle,
            });

            const savedSubscription = await subscriptionRepository.save(subscription);
            savedPurchase.paymentReference = savedSubscription.id;
            await purchaseRepository.save(savedPurchase);
        });

        await this.subscriptionsService.syncUserPremiumState(userId);
    }

    private initStripe(): void {
        const secretKey =
            this.configService.get<string>('stripe.secretKey') ||
            this.configService.get<string>('STRIPE_SECRET_KEY') ||
            '';

        this.webhookSecret =
            this.configService.get<string>('stripe.webhookSecret') ||
            this.configService.get<string>('STRIPE_WEBHOOK_SECRET') ||
            '';

        if (!secretKey) {
            this.logger.warn(
                'STRIPE_SECRET_KEY not set. Stripe payment endpoints will be disabled.',
            );
            return;
        }

        try {
            this.stripe = new Stripe(secretKey, {
                apiVersion: '2024-06-20' as any,
            });
            this.logger.log('Stripe client initialized successfully.');
        } catch (error) {
            this.logger.error(`Failed to initialize Stripe client: ${(error as Error).message}`);
        }
    }
}

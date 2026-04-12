import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription, SubscriptionStatus } from '../../database/entities/subscription.entity';
import { Plan } from '../../database/entities/plan.entity';
import { User } from '../../database/entities/user.entity';
import Stripe from 'stripe';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { RedisService } from '../redis/redis.service';

export enum PaymentProvider {
    STRIPE = 'stripe',
    APPLE_PAY = 'apple_pay',
    GOOGLE_PAY = 'google_pay',
}

export enum PaymentStatus {
    PENDING = 'pending',
    COMPLETED = 'completed',
    FAILED = 'failed',
    REFUNDED = 'refunded',
}

export interface CreateCheckoutSessionDto {
    planCode: string;
    provider: PaymentProvider;
}

export interface PaymentResult {
    success: boolean;
    paymentId?: string;
    checkoutUrl?: string;
    error?: string;
    customerId?: string;
}

@Injectable()
export class PaymentsService {
    private readonly logger = new Logger(PaymentsService.name);

    private stripe: Stripe;

    constructor(
        private readonly configService: ConfigService,
        @InjectRepository(Subscription)
        private readonly subscriptionRepository: Repository<Subscription>,
        @InjectRepository(Plan)
        private readonly planRepository: Repository<Plan>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        private readonly subscriptionsService: SubscriptionsService,
        private readonly redisService: RedisService,
    ) {
        const stripeKey = this.configService.get<string>('STRIPE_SECRET_KEY') || this.configService.get<string>('stripe.secretKey');
        if (stripeKey) {
            this.stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' as any });
        }
    }

    // ─── CUSTOMER MANAGEMENT ─────────────────────────────────

    async createCustomer(email: string, name: string): Promise<string | null> {
        if (!this.stripe) return null;
        try {
            const customer = await this.stripe.customers.create({ email, name });
            return customer.id;
        } catch (error) {
            this.logger.error(`Failed to create Stripe customer: ${(error as Error).message}`);
            return null;
        }
    }

    // ─── CREATE CHECKOUT SESSION ───────────────────────────────

    async createCheckoutSession(
        userId: string,
        dto: CreateCheckoutSessionDto,
    ): Promise<PaymentResult> {
        const { planCode, provider } = dto;

        // Load plan from DB — backend is source of truth
        const plan = await this.planRepository.findOne({
            where: { code: planCode, isActive: true, isVisible: true },
        });
        if (!plan) throw new BadRequestException(`Plan '${planCode}' not found, inactive, or hidden`);
        if (plan.price === 0) throw new BadRequestException('Cannot create payment for free plan');

        switch (provider) {
            case PaymentProvider.STRIPE:
                return this.createStripeCheckoutSession(userId, plan);
            case PaymentProvider.APPLE_PAY:
                return this.createApplePaySession(userId, plan);
            case PaymentProvider.GOOGLE_PAY:
                return this.createGooglePaySession(userId, plan);
            default:
                throw new BadRequestException('Unsupported payment provider');
        }
    }

    // ─── STRIPE CHECKOUT SESSION ──────────────────────────────

    async createStripeCheckoutSession(
        userId: string,
        plan: Plan,
    ): Promise<PaymentResult> {
        if (!this.stripe) {
            this.logger.error('Stripe secret key is not configured');
            throw new ServiceUnavailableException('Stripe is not configured on the server.');
        }

        if (!plan.stripePriceId) {
            this.logger.error(`No Stripe Price ID configured for plan ${plan.code}`);
            throw new ServiceUnavailableException(`Stripe pricing not configured for plan: ${plan.code}`);
        }

        try {
            const user = await this.userRepository.findOne({ where: { id: userId }, select: ['id', 'email', 'firstName', 'lastName', 'stripeCustomerId'] });
            if (!user) throw new BadRequestException('User not found');

            let customerId: string | null = user.stripeCustomerId;
            if (!customerId) {
                customerId = await this.createCustomer(user.email, `${user.firstName} ${user.lastName}`);
                if (customerId) await this.userRepository.update(user.id, { stripeCustomerId: customerId });
            }
            if (!customerId) throw new BadRequestException('Failed to initialize Stripe customer');

            const successUrl = this.configService.get<string>('STRIPE_SUCCESS_URL') || 'methna://payment-success';
            const cancelUrl = this.configService.get<string>('STRIPE_CANCEL_URL') || 'methna://payment-cancel';

            // Determine checkout mode based on billing cycle
            const isOneTime = plan.billingCycle === 'one_time';
            const mode: 'subscription' | 'payment' = isOneTime ? 'payment' : 'subscription';

            const sessionParams: Stripe.Checkout.SessionCreateParams = {
                customer: customerId,
                mode,
                line_items: [{ price: plan.stripePriceId, quantity: 1 }],
                success_url: successUrl,
                cancel_url: cancelUrl,
                metadata: {
                    userId,
                    planId: plan.id,
                    planCode: plan.code,
                },
            };

            // Only include subscription_data for recurring plans
            if (!isOneTime) {
                sessionParams.subscription_data = {
                    metadata: {
                        userId,
                        planId: plan.id,
                        planCode: plan.code,
                    },
                };
            } else {
                // For one-time payments, put metadata in payment_intent_data
                sessionParams.payment_intent_data = {
                    metadata: {
                        userId,
                        planId: plan.id,
                        planCode: plan.code,
                    },
                };
            }

            const session = await this.stripe.checkout.sessions.create(sessionParams);

            this.logger.log(`Stripe checkout session created for user ${userId}, plan: ${plan.code}, mode: ${mode}, session: ${session.id}`);

            return {
                success: true,
                paymentId: session.id,
                checkoutUrl: session.url || undefined,
                customerId,
            };
        } catch (error) {
            this.logger.error('Stripe checkout session creation failed', (error as Error).message);
            return { success: false, error: (error as Error).message };
        }
    }

    // ─── LEGACY STRIPE SUBSCRIPTION (kept for backward compat) ──

    async createStripeSubscription(
        userId: string,
        plan: Plan,
        stripeCustomerId: string,
    ): Promise<PaymentResult> {
        // Delegate to checkout session flow
        return this.createStripeCheckoutSession(userId, plan);
    }

    // ─── APPLE PAY INTEGRATION ──────────────────────────────

    private async createApplePaySession(
        userId: string,
        plan: Plan,
    ): Promise<PaymentResult> {
        // TODO: Integrate with Apple Pay server-side validation
        this.logger.log(`Apple Pay session requested for user ${userId}, plan: ${plan.code}`);
        return {
            success: false,
            error: 'Apple Pay is not yet supported',
        };
    }

    // ─── GOOGLE PAY INTEGRATION ─────────────────────────────

    private async createGooglePaySession(
        userId: string,
        plan: Plan,
    ): Promise<PaymentResult> {
        // TODO: Integrate with Google Pay server-side validation
        this.logger.log(`Google Pay session requested for user ${userId}, plan: ${plan.code}`);
        return {
            success: false,
            error: 'Google Pay is not yet supported',
        };
    }

    // ─── WEBHOOK HANDLER (Stripe) ────────────────────────────

    async handleStripeWebhook(rawBody: string, signature: string): Promise<void> {
        const endpointSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');

        if (!this.stripe || !endpointSecret) {
            this.logger.error('Stripe webhook received but STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET is not configured — rejecting');
            throw new BadRequestException('Stripe webhook is not configured on the server');
        }

        let event: Stripe.Event;
        try {
            // Verify webhook signature with Stripe SDK using raw body string
            event = this.stripe.webhooks.constructEvent(
                rawBody,
                signature,
                endpointSecret,
            );
            this.logger.log(`Stripe webhook verified: event=${event.type} id=${event.id}`);
        } catch (err) {
            this.logger.error(`Webhook signature verification failed.`, (err as Error).message);
            throw new BadRequestException('Webhook signature verification failed');
        }

        // Idempotency: skip if we already processed this event
        const eventId = event.id;
        if (eventId) {
            const alreadyProcessed = await this.isEventProcessed(eventId);
            if (alreadyProcessed) {
                this.logger.log(`Stripe event ${eventId} already processed — skipping`);
                return;
            }
        }

        switch (event.type) {
            case 'checkout.session.completed':
                await this.handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
                break;
            case 'invoice.paid':
                await this.handlePaymentSuccess(event.data.object as Stripe.Invoice);
                break;
            case 'payment_intent.succeeded':
                await this.handlePaymentSuccess(event.data.object as Stripe.PaymentIntent);
                break;
            case 'invoice.payment_failed':
            case 'payment_intent.payment_failed':
                await this.handlePaymentFailure(event.data.object);
                break;
            case 'customer.subscription.deleted':
            case 'customer.subscription.updated':
                await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
                break;
            default:
                this.logger.log(`Unhandled Stripe event: ${event.type}`);
        }

        // Mark event as processed
        if (eventId) {
            await this.markEventProcessed(eventId);
        }
    }

    private async isEventProcessed(eventId: string): Promise<boolean> {
        // Use a simple Redis key to track processed events (48h TTL)
        const key = `stripe_event:${eventId}`;
        const existing = await this.redisService.get(key);
        return existing === '1';
    }

    private async markEventProcessed(eventId: string): Promise<void> {
        const key = `stripe_event:${eventId}`;
        // 48 hours TTL — Stripe retries for up to 3 days, but 48h is enough
        // for idempotency protection against duplicate deliveries.
        await this.redisService.set(key, '1', 48 * 3600);
    }

    // ─── CHECKOUT SESSION COMPLETED ──────────────────────────

    private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
        const userId = session.metadata?.userId;
        const planId = session.metadata?.planId;
        const planCode = session.metadata?.planCode;
        const sessionId = session.id;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;
        const paymentIntentId = session.payment_intent as string;

        // Resolve userId from customer if metadata missing
        let finalUserId = userId;
        if (!finalUserId && customerId) {
            const user = await this.userRepository.findOne({
                where: { stripeCustomerId: customerId },
                select: ['id'],
            });
            if (user) finalUserId = user.id;
        }

        if (!finalUserId) {
            this.logger.warn(`checkout.session.completed: unable to resolve userId for session ${sessionId}`);
            return;
        }

        // Load plan from DB using planId or planCode
        let planEntity: Plan | null = null;
        if (planId) {
            planEntity = await this.planRepository.findOne({ where: { id: planId } });
        }
        if (!planEntity && planCode) {
            planEntity = await this.planRepository.findOne({ where: { code: planCode } });
        }
        // Legacy: try session.metadata.plan as enum code
        if (!planEntity && session.metadata?.plan) {
            planEntity = await this.planRepository.findOne({ where: { code: session.metadata.plan } });
        }

        if (!planEntity) {
            this.logger.warn(`checkout.session.completed: plan not found (planId=${planId}, planCode=${planCode}) for session ${sessionId}`);
            return;
        }

        this.logger.log(`Checkout session completed: user=${finalUserId} plan=${planEntity.code} session=${sessionId}`);

        // Derive duration from plan
        const durationDays = planEntity.durationDays || 30;
        const now = new Date();
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + durationDays);

        // Upsert subscription
        // Find existing active/past_due subscription for this user
        let existingSub = await this.subscriptionRepository.findOne({
            where: [
                { userId: finalUserId, status: SubscriptionStatus.ACTIVE },
                { userId: finalUserId, status: SubscriptionStatus.PAST_DUE },
            ],
            order: { createdAt: 'DESC' },
        });

        // Cancel any other active subscriptions (plan upgrade)
        if (existingSub && existingSub.stripeSubscriptionId && existingSub.stripeSubscriptionId !== subscriptionId) {
            existingSub.status = SubscriptionStatus.CANCELLED;
            await this.subscriptionRepository.save(existingSub);
            existingSub = null; // Create a new subscription below
        }

        if (existingSub) {
            existingSub.plan = planEntity.code as any; // legacy compat
            existingSub.planId = planEntity.id;
            existingSub.planEntity = planEntity;
            existingSub.status = SubscriptionStatus.ACTIVE;
            existingSub.startDate = now;
            existingSub.endDate = endDate;
            existingSub.paymentReference = paymentIntentId || sessionId;
            existingSub.stripeSubscriptionId = subscriptionId || null;
            existingSub.stripeCheckoutSessionId = sessionId;
            existingSub.billingCycle = planEntity.billingCycle;
            if (customerId) existingSub.stripeCustomerId = customerId;
            await this.subscriptionRepository.save(existingSub);
        } else {
            existingSub = this.subscriptionRepository.create({
                userId: finalUserId,
                plan: planEntity.code as any, // legacy compat
                planId: planEntity.id,
                planEntity,
                status: SubscriptionStatus.ACTIVE,
                startDate: now,
                endDate,
                paymentReference: paymentIntentId || sessionId,
                stripeSubscriptionId: subscriptionId || null,
                stripeCheckoutSessionId: sessionId,
                stripeCustomerId: customerId || null,
                billingCycle: planEntity.billingCycle,
            });
            await this.subscriptionRepository.save(existingSub);
        }

        // Link Stripe customer to user if not already linked
        if (customerId) {
            await this.userRepository.update(finalUserId, { stripeCustomerId: customerId });
        }

        // Invalidate entitlements cache so features unlock immediately
        await this.redisService.del(`entitlements:${finalUserId}`);
        await this.redisService.del(`plan:${finalUserId}`);
        await this.redisService.del(`features:${finalUserId}`);
        await this.redisService.del(`premium:${finalUserId}`);

        await this.subscriptionsService.syncUserPremiumState(finalUserId);
        this.logger.log(`Subscription activated via checkout for user ${finalUserId}, plan: ${planEntity.code}`);
    }

    private async handlePaymentSuccess(stripeObject: any): Promise<void> {
        const userId = stripeObject?.metadata?.userId || (stripeObject.subscription_details?.metadata?.userId);
        const planCode = stripeObject?.metadata?.planCode || stripeObject?.metadata?.plan;
        const planId = stripeObject?.metadata?.planId;
        
        let subscriptionId = stripeObject.subscription;
        if (!subscriptionId && stripeObject.id?.startsWith('sub_')) subscriptionId = stripeObject.id;

        // If no metadata but we have customer, we can look up by stripeCustomerId
        let finalUserId = userId;
        if (!finalUserId && stripeObject.customer) {
             const user = await this.userRepository.findOne({ where: { stripeCustomerId: stripeObject.customer as string } });
             if (user) finalUserId = user.id;
        }

        if (!finalUserId) {
            this.logger.warn(`Stripe object succeeded but unable to find user metadata. Object ID: ${stripeObject.id}`);
            return;
        }

        // Load plan from DB
        let planEntity: Plan | null = null;
        if (planId) planEntity = await this.planRepository.findOne({ where: { id: planId } });
        if (!planEntity && planCode) planEntity = await this.planRepository.findOne({ where: { code: planCode } });

        const durationDays = planEntity?.durationDays || 30;

        let existingSub = await this.subscriptionRepository.findOne({
            where: [
                { userId: finalUserId, status: SubscriptionStatus.ACTIVE },
                { userId: finalUserId, status: SubscriptionStatus.PAST_DUE },
            ],
            order: { createdAt: 'DESC' },
        });
        if (existingSub) {
            if (planEntity) {
                existingSub.plan = planEntity.code as any;
                existingSub.planId = planEntity.id;
                existingSub.planEntity = planEntity;
            }
            existingSub.status = SubscriptionStatus.ACTIVE;
            existingSub.startDate = new Date();
            existingSub.endDate = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
            existingSub.paymentReference = stripeObject.id;
            if (subscriptionId) existingSub.stripeSubscriptionId = subscriptionId as string;
            await this.subscriptionRepository.save(existingSub);
        } else if (planEntity) {
            existingSub = this.subscriptionRepository.create({
                userId: finalUserId,
                plan: planEntity.code as any,
                planId: planEntity.id,
                planEntity,
                status: SubscriptionStatus.ACTIVE,
                startDate: new Date(),
                endDate: new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000),
                paymentReference: stripeObject.id,
                stripeSubscriptionId: subscriptionId as string,
            });
            await this.subscriptionRepository.save(existingSub);
        }

        // Invalidate caches
        await this.redisService.del(`entitlements:${finalUserId}`);
        await this.redisService.del(`plan:${finalUserId}`);
        await this.redisService.del(`features:${finalUserId}`);
        await this.redisService.del(`premium:${finalUserId}`);

        await this.subscriptionsService.syncUserPremiumState(finalUserId);
        this.logger.log(`Subscription activated for user ${finalUserId}`);
    }

    private async handlePaymentFailure(stripeObject: any): Promise<void> {
        let finalUserId = stripeObject?.metadata?.userId;
        if (!finalUserId && stripeObject.customer) {
             const user = await this.userRepository.findOne({ where: { stripeCustomerId: stripeObject.customer as string } });
             if (user) finalUserId = user.id;
        }
        this.logger.warn(`Payment failed for user ${finalUserId}`);

        // Mark as PAST_DUE — this is a retryable failure, not a permanent expiry.
        // Stripe will retry the payment. The subscription stays active but flagged.
        if (finalUserId) {
            await this.subscriptionRepository.update(
                { userId: finalUserId, status: SubscriptionStatus.ACTIVE },
                { status: SubscriptionStatus.PAST_DUE },
            );
            // Do NOT revoke premium immediately — Stripe will retry.
            // syncUserPremiumState will check PAST_DUE and keep premium until truly expired.
        }
    }

    private async handleSubscriptionUpdated(subscription: any): Promise<void> {
        const stripeSubscriptionId = subscription?.id;
        let finalUserId = subscription?.metadata?.userId;
        if (!finalUserId && subscription.customer) {
             const user = await this.userRepository.findOne({ where: { stripeCustomerId: subscription.customer as string } });
             if (user) finalUserId = user.id;
        }
        if (!finalUserId) return;

        if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
            // Only cancel the specific Stripe subscription, not all user subscriptions
            if (stripeSubscriptionId) {
                await this.subscriptionRepository.update(
                    { userId: finalUserId, stripeSubscriptionId },
                    { status: SubscriptionStatus.CANCELLED },
                );
            } else {
                await this.subscriptionRepository.update(
                    { userId: finalUserId, status: SubscriptionStatus.ACTIVE },
                    { status: SubscriptionStatus.CANCELLED },
                );
            }
            await this.subscriptionsService.syncUserPremiumState(finalUserId);
            this.logger.log(`Subscription cancelled for user ${finalUserId}`);
        } else if (subscription.status === 'active') {
            if (stripeSubscriptionId) {
                await this.subscriptionRepository.update(
                    { userId: finalUserId, stripeSubscriptionId },
                    { status: SubscriptionStatus.ACTIVE, stripeSubscriptionId },
                );
            } else {
                await this.subscriptionRepository.update(
                    { userId: finalUserId, status: SubscriptionStatus.PAST_DUE },
                    { status: SubscriptionStatus.ACTIVE },
                );
            }
            await this.subscriptionsService.syncUserPremiumState(finalUserId);
        }
    }

    // ─── PRICING INFO ────────────────────────────────────────

    async getPricing() {
        const plans = await this.planRepository.find({
            where: { isActive: true, isVisible: true },
            order: { sortOrder: 'ASC', price: 'ASC' },
        });

        return {
            plans: plans.map(p => ({
                id: p.id,
                code: p.code,
                name: p.name,
                price: Number(p.price),
                currency: p.currency,
                billingCycle: p.billingCycle,
                durationDays: p.durationDays,
                entitlements: p.entitlements,
                features: p.features,
                description: p.description,
            })),
            providers: Object.values(PaymentProvider),
        };
    }
}



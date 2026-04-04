import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription, SubscriptionPlan, SubscriptionStatus } from '../../database/entities/subscription.entity';
import { User } from '../../database/entities/user.entity';
import Stripe from 'stripe';

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

export interface CreatePaymentIntentDto {
    plan: SubscriptionPlan;
    provider: PaymentProvider;
    currency?: string;
}

export interface PaymentResult {
    success: boolean;
    paymentId?: string;
    clientSecret?: string;
    error?: string;
    customerId?: string;
    ephemeralKey?: string;
}

@Injectable()
export class PaymentsService {
    private readonly logger = new Logger(PaymentsService.name);

    private readonly PLAN_PRICES: Record<SubscriptionPlan, number> = {
        [SubscriptionPlan.FREE]: 0,
        [SubscriptionPlan.PREMIUM]: 1499, // $14.99 in cents
        [SubscriptionPlan.GOLD]: 2999,    // $29.99 in cents
    };

    private stripe: Stripe;

    constructor(
        private readonly configService: ConfigService,
        @InjectRepository(Subscription)
        private readonly subscriptionRepository: Repository<Subscription>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
    ) {
        const stripeKey = this.configService.get<string>('STRIPE_SECRET_KEY');
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

    // ─── CREATE PAYMENT INTENT ───────────────────────────────

    async createPaymentIntent(
        userId: string,
        dto: CreatePaymentIntentDto,
    ): Promise<PaymentResult> {
        const { plan, provider, currency = 'usd' } = dto;

        if (plan === SubscriptionPlan.FREE) {
            throw new BadRequestException('Cannot create payment for free plan');
        }

        const amount = this.PLAN_PRICES[plan];
        if (!amount) {
            throw new BadRequestException('Invalid plan');
        }

        switch (provider) {
            case PaymentProvider.STRIPE:
                const user = await this.userRepository.findOne({ where: { id: userId }, select: ['id', 'email', 'firstName', 'lastName', 'stripeCustomerId'] });
                if (!user) throw new BadRequestException('User not found');
                
                let customerId: string | null = user.stripeCustomerId;
                if (!customerId && this.stripe) {
                    customerId = await this.createCustomer(user.email, `${user.firstName} ${user.lastName}`);
                    if (customerId) await this.userRepository.update(user.id, { stripeCustomerId: customerId });
                }
                
                if (!customerId) throw new BadRequestException('Failed to initialize Stripe customer');
                
                return this.createStripeSubscription(userId, plan, customerId as string);
            case PaymentProvider.APPLE_PAY:
                return this.createApplePaySession(userId, amount, currency, plan);
            case PaymentProvider.GOOGLE_PAY:
                return this.createGooglePaySession(userId, amount, currency, plan);
            default:
                throw new BadRequestException('Unsupported payment provider');
        }
    }

    // ─── STRIPE INTEGRATION ─────────────────────────────────

    async createStripeSubscription(
        userId: string,
        plan: SubscriptionPlan,
        stripeCustomerId: string,
    ): Promise<PaymentResult> {
        if (!this.stripe) {
            this.logger.error('Stripe secret key is not configured');
            throw new ServiceUnavailableException('Stripe is not configured on the server.');
        }

        try {
            let priceId = '';
            if (plan === SubscriptionPlan.PREMIUM) priceId = this.configService.get<string>('STRIPE_PRICE_PREMIUM') || 'price_premium';
            else if (plan === SubscriptionPlan.GOLD) priceId = this.configService.get<string>('STRIPE_PRICE_GOLD') || 'price_gold';

            const subscription = await this.stripe.subscriptions.create({
                customer: stripeCustomerId,
                items: [{ price: priceId }],
                payment_behavior: 'default_incomplete',
                payment_settings: { save_default_payment_method: 'on_subscription' },
                expand: ['latest_invoice.payment_intent'],
                metadata: { userId, plan },
            });

            const invoice = subscription.latest_invoice as any;
            const paymentIntent = invoice?.payment_intent as any;

            const ephemeralKey = await this.stripe.ephemeralKeys.create(
                { customer: stripeCustomerId },
                { apiVersion: '2023-10-16' as any }
            );
            
            this.logger.log(`Stripe subscription created for user ${userId}, plan: ${plan}`);
            return {
                success: true,
                paymentId: subscription.id,
                clientSecret: paymentIntent?.client_secret || '',
                customerId: stripeCustomerId,
                ephemeralKey: ephemeralKey.secret,
            };
        } catch (error) {
            this.logger.error('Stripe subscription creation failed', (error as Error).message);
            return { success: false, error: (error as Error).message };
        }
    }

    // ─── APPLE PAY INTEGRATION ──────────────────────────────

    private async createApplePaySession(
        userId: string,
        amount: number,
        currency: string,
        plan: SubscriptionPlan,
    ): Promise<PaymentResult> {
        // TODO: Integrate with Apple Pay server-side validation
        this.logger.log(`Apple Pay session requested for user ${userId}, plan: ${plan}`);
        return {
            success: true,
            paymentId: `apple_${Date.now()}`,
            clientSecret: `apple_session_${Date.now()}`,
        };
    }

    // ─── GOOGLE PAY INTEGRATION ─────────────────────────────

    private async createGooglePaySession(
        userId: string,
        amount: number,
        currency: string,
        plan: SubscriptionPlan,
    ): Promise<PaymentResult> {
        // TODO: Integrate with Google Pay server-side validation
        this.logger.log(`Google Pay session requested for user ${userId}, plan: ${plan}`);
        return {
            success: true,
            paymentId: `google_${Date.now()}`,
            clientSecret: `google_session_${Date.now()}`,
        };
    }

    // ─── WEBHOOK HANDLER (Stripe) ────────────────────────────

    async handleStripeWebhook(payload: any, signature: string): Promise<void> {
        const endpointSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');

        let event = payload;
        if (this.stripe && endpointSecret) {
            try {
                // Verify webhook signature with Stripe SDK
                event = this.stripe.webhooks.constructEvent(payload, signature, endpointSecret);
            } catch (err) {
                this.logger.error(`Webhook signature verification failed.`, (err as Error).message);
                throw new BadRequestException('Webhook Error');
            }
        }

        switch (event.type) {
            case 'invoice.paid':
            case 'payment_intent.succeeded':
                await this.handlePaymentSuccess(event.data.object);
                break;
            case 'invoice.payment_failed':
            case 'payment_intent.payment_failed':
                await this.handlePaymentFailure(event.data.object);
                break;
            case 'customer.subscription.deleted':
            case 'customer.subscription.updated':
                await this.handleSubscriptionUpdated(event.data.object);
                break;
            default:
                this.logger.log(`Unhandled Stripe event: ${event.type}`);
        }
    }

    private async handlePaymentSuccess(stripeObject: any): Promise<void> {
        const userId = stripeObject?.metadata?.userId || (stripeObject.subscription_details?.metadata?.userId);
        const plan = stripeObject?.metadata?.plan || (stripeObject.subscription_details?.metadata?.plan) as SubscriptionPlan;
        
        let subscriptionId = stripeObject.subscription;
        if (!subscriptionId && stripeObject.id.startsWith('sub_')) subscriptionId = stripeObject.id;

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

        let existingSub = await this.subscriptionRepository.findOne({ where: { userId: finalUserId } });
        if (existingSub) {
            if (plan) existingSub.plan = plan;
            existingSub.status = SubscriptionStatus.ACTIVE;
            existingSub.startDate = new Date();
            existingSub.endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // +30 days
            existingSub.paymentReference = stripeObject.id;
            if (subscriptionId) existingSub.stripeSubscriptionId = subscriptionId as string;
            await this.subscriptionRepository.save(existingSub);
        } else if (plan) {
            existingSub = this.subscriptionRepository.create({
                userId: finalUserId,
                plan: plan,
                status: SubscriptionStatus.ACTIVE,
                startDate: new Date(),
                endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                paymentReference: stripeObject.id,
                stripeSubscriptionId: subscriptionId as string,
            });
            await this.subscriptionRepository.save(existingSub);
        }

        this.logger.log(`Subscription activated for user ${finalUserId}`);
    }

    private async handlePaymentFailure(stripeObject: any): Promise<void> {
        let finalUserId = stripeObject?.metadata?.userId;
        if (!finalUserId && stripeObject.customer) {
             const user = await this.userRepository.findOne({ where: { stripeCustomerId: stripeObject.customer as string } });
             if (user) finalUserId = user.id;
        }
        this.logger.warn(`Payment failed for user ${finalUserId}`);
        
        // Mark past due
        if (finalUserId) {
            await this.subscriptionRepository.update(
                { userId: finalUserId, status: SubscriptionStatus.ACTIVE },
                { status: SubscriptionStatus.EXPIRED },
            );
        }
    }

    private async handleSubscriptionUpdated(subscription: any): Promise<void> {
        let finalUserId = subscription?.metadata?.userId;
        if (!finalUserId && subscription.customer) {
             const user = await this.userRepository.findOne({ where: { stripeCustomerId: subscription.customer as string } });
             if (user) finalUserId = user.id;
        }
        if (!finalUserId) return;

        if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
            await this.subscriptionRepository.update(
                { userId: finalUserId },
                { status: SubscriptionStatus.CANCELLED },
            );
            this.logger.log(`Subscription cancelled for user ${finalUserId}`);
        } else if (subscription.status === 'active') {
             await this.subscriptionRepository.update(
                { userId: finalUserId },
                { status: SubscriptionStatus.ACTIVE, stripeSubscriptionId: subscription.id },
            );
        }
    }

    // ─── PRICING INFO ────────────────────────────────────────

    getPricing() {
        return {
            plans: [
                {
                    name: 'Free',
                    plan: SubscriptionPlan.FREE,
                    price: 0,
                    currency: 'usd',
                    features: ['10 daily swipes', 'Basic matching', 'Chat after match'],
                },
                {
                    name: 'Premium',
                    plan: SubscriptionPlan.PREMIUM,
                    price: 14.99,
                    currency: 'usd',
                    features: [
                        'Unlimited swipes', 'See who liked you', 'Super likes',
                        'Rewind', 'Advanced filters', 'Read receipts',
                        'Compliment credits', 'Rematch', 'Passport mode',
                    ],
                },
                {
                    name: 'Elite',
                    plan: SubscriptionPlan.GOLD,
                    price: 29.99,
                    currency: 'usd',
                    features: [
                        'All Premium features', 'Profile boost', 'Invisible mode',
                        'Hide ads', 'Premium badge', 'Priority support',
                    ],
                },
            ],
            providers: Object.values(PaymentProvider),
        };
    }
}



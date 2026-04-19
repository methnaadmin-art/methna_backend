import {
    BadRequestException,
    Injectable,
    Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
    Plan,
    PlanEntitlements,
    PlanFeatureFlags,
    PlanLimits,
} from '../../database/entities/plan.entity';
import {
    Subscription,
    SubscriptionStatus,
} from '../../database/entities/subscription.entity';
import { PurchaseTransaction } from '../../database/entities/purchase-transaction.entity';
import { User } from '../../database/entities/user.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { RedisService } from '../redis/redis.service';

export enum PaymentProvider {
    GOOGLE_PLAY = 'google_play',
}

export interface CreateCheckoutSessionDto {
    planCode: string;
    provider?: PaymentProvider | string;
    platform?: string;
}

export interface PaymentResult {
    success: boolean;
    provider: PaymentProvider;
    action: 'verify_purchase';
    error?: string;
    managementUrl?: string;
}

@Injectable()
export class PaymentsService {
    private readonly logger = new Logger(PaymentsService.name);

    constructor(
        private readonly configService: ConfigService,
        @InjectRepository(Subscription)
        private readonly subscriptionRepository: Repository<Subscription>,
        @InjectRepository(Plan)
        private readonly planRepository: Repository<Plan>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(PurchaseTransaction)
        private readonly purchaseTransactionRepository: Repository<PurchaseTransaction>,
        private readonly subscriptionsService: SubscriptionsService,
        private readonly redisService: RedisService,
    ) { }

    // Legacy no-op kept for auth compatibility (historically created Stripe customer).
    async createCustomer(_email: string, _name: string): Promise<string | null> {
        return null;
    }

    async createCheckoutSession(
        _userId: string,
        _dto: CreateCheckoutSessionDto,
    ): Promise<PaymentResult> {
        throw new BadRequestException(
            'Web checkout is disabled. This backend is Google Play Billing only. Use /payments/google-play/verify from Android purchase flow.',
        );
    }

    async getSubscriptionManagementUrl(
        userId: string,
    ): Promise<{ url: string; provider: PaymentProvider; activeSubscriptionId: string | null }> {
        const active = await this.subscriptionRepository.findOne({
            where: [
                { userId, status: SubscriptionStatus.ACTIVE },
                { userId, status: SubscriptionStatus.PENDING_CANCELLATION },
                { userId, status: SubscriptionStatus.PAST_DUE },
                { userId, status: SubscriptionStatus.TRIAL },
            ],
            order: { updatedAt: 'DESC' },
        });

        return {
            provider: PaymentProvider.GOOGLE_PLAY,
            url: this.getGooglePlayManagementUrl(),
            activeSubscriptionId: active?.id ?? null,
        };
    }

    async getPricing() {
        const plans = await this.planRepository.find({
            where: { isActive: true, isVisible: true },
            order: { sortOrder: 'ASC', price: 'ASC' },
        });

        return {
            billingModel: 'google_play_billing_only',
            providers: [PaymentProvider.GOOGLE_PLAY],
            plans: plans.map((plan) => {
                const entitlements = this.resolveEntitlements(plan);
                return {
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
                    features: this.toFeatureFlags(plan, entitlements),
                    limits: this.toLimits(plan, entitlements),
                    entitlements,
                };
            }),
        };
    }

    // Legacy endpoint support: explicitly disabled for Stripe-only webhook traffic.
    async handleStripeWebhook(_rawBody: string, _signature: string, _requestId: string = 'n/a'): Promise<void> {
        throw new BadRequestException('Stripe webhook endpoint is disabled. Billing provider is Google Play only.');
    }

    // Legacy helper to keep compile compatibility where older code may call this method.
    async createStripeCheckoutSession(_userId: string, _plan: Plan): Promise<PaymentResult> {
        throw new BadRequestException('Stripe checkout is disabled. Use Google Play Billing verification endpoint.');
    }

    private resolveEntitlements(plan: Plan): PlanEntitlements {
        const entitlements: PlanEntitlements = {
            ...(plan.entitlements || {}),
        };

        if (entitlements.dailyLikes === undefined) {
            entitlements.dailyLikes = plan.dailyLikesLimit;
        }
        if (entitlements.dailySuperLikes === undefined) {
            entitlements.dailySuperLikes = plan.dailySuperLikesLimit;
        }
        if (entitlements.dailyCompliments === undefined) {
            entitlements.dailyCompliments = plan.dailyComplimentsLimit;
        }
        if (entitlements.monthlyRewinds === undefined) {
            entitlements.monthlyRewinds = plan.monthlyRewindsLimit;
        }
        if (entitlements.weeklyBoosts === undefined) {
            entitlements.weeklyBoosts = plan.weeklyBoostsLimit;
        }

        if (entitlements.likesLimit === undefined && entitlements.dailyLikes !== undefined) {
            entitlements.likesLimit = entitlements.dailyLikes;
        }
        if (entitlements.boostsLimit === undefined && entitlements.weeklyBoosts !== undefined) {
            entitlements.boostsLimit = entitlements.weeklyBoosts;
        }
        if (entitlements.complimentsLimit === undefined && entitlements.dailyCompliments !== undefined) {
            entitlements.complimentsLimit = entitlements.dailyCompliments;
        }

        if (entitlements.dailyLikes === -1) {
            entitlements.unlimitedLikes = true;
            entitlements.likes = true;
        }
        if (entitlements.monthlyRewinds === -1) {
            entitlements.unlimitedRewinds = true;
        }

        return entitlements;
    }

    private toFeatureFlags(plan: Plan, entitlements: PlanEntitlements): PlanFeatureFlags {
        return {
            ...(plan.featureFlags || {}),
            unlimitedLikes: entitlements.unlimitedLikes,
            unlimitedRewinds: entitlements.unlimitedRewinds,
            advancedFilters: entitlements.advancedFilters,
            seeWhoLikesYou: entitlements.seeWhoLikesYou,
            whoLikedMe: entitlements.whoLikedMe,
            readReceipts: entitlements.readReceipts,
            typingIndicators: entitlements.typingIndicators,
            invisibleMode: entitlements.invisibleMode,
            ghostMode: entitlements.ghostMode,
            passportMode: entitlements.passportMode,
            boost: entitlements.boost,
            likes: entitlements.likes,
            premiumBadge: entitlements.premiumBadge,
            hideAds: entitlements.hideAds,
            rematch: entitlements.rematch,
            videoChat: entitlements.videoChat,
            superLike: entitlements.superLike,
            profileBoostPriority: entitlements.profileBoostPriority,
            priorityMatching: entitlements.priorityMatching,
            improvedVisits: entitlements.improvedVisits,
        };
    }

    private toLimits(plan: Plan, entitlements: PlanEntitlements): PlanLimits {
        return {
            ...(plan.limits || {}),
            dailyLikes: entitlements.dailyLikes,
            dailySuperLikes: entitlements.dailySuperLikes,
            dailyCompliments: entitlements.dailyCompliments,
            monthlyRewinds: entitlements.monthlyRewinds,
            weeklyBoosts: entitlements.weeklyBoosts,
            likesLimit: entitlements.likesLimit,
            boostsLimit: entitlements.boostsLimit,
            complimentsLimit: entitlements.complimentsLimit,
        };
    }

    private getGooglePlayManagementUrl(): string {
        return this.normalizeConfigValue(
            this.configService.get<string>('GOOGLE_PLAY_SUBSCRIPTION_MANAGEMENT_URL') ||
            this.configService.get<string>('googlePlay.subscriptionManagementUrl') ||
            'https://play.google.com/store/account/subscriptions',
        );
    }

    private normalizeConfigValue(value?: string): string {
        if (!value) {
            return '';
        }
        const trimmed = value.trim();
        return trimmed.replace(/^"|"$/g, '').replace(/^'|'$/g, '').trim();
    }
}

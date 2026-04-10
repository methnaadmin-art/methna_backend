import {
    Injectable,
    NotFoundException,
    BadRequestException,
    Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
    Subscription,
    SubscriptionPlan,
    SubscriptionStatus,
} from '../../database/entities/subscription.entity';
import { User } from '../../database/entities/user.entity';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class SubscriptionsService {
    private readonly logger = new Logger(SubscriptionsService.name);
    private hasLoggedMissingPremiumColumns = false;

    constructor(
        @InjectRepository(Subscription)
        private readonly subscriptionRepository: Repository<Subscription>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        private readonly redisService: RedisService,
    ) { }

    async createTrialSubscription(userId: string, days: number = 3): Promise<Subscription> {
        // Check if user already has a subscription
        const existing = await this.subscriptionRepository.findOne({
            where: { userId },
        });

        if (existing) {
            // If they have one, don't give a trial (prevents abuse)
            return existing;
        }

        const now = new Date();
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + days);

        const subscription = this.subscriptionRepository.create({
            userId,
            plan: SubscriptionPlan.PREMIUM, // Default trial to premium
            status: SubscriptionStatus.ACTIVE,
            startDate: now,
            endDate,
        });

        const saved = await this.subscriptionRepository.save(subscription);
        await this.updateUserPremiumState(userId, true, now, endDate);
        await this.invalidatePremiumCaches(userId);
        
        return saved;
    }

    async getMySubscription(userId: string): Promise<Subscription> {
        let sub = await this.subscriptionRepository.findOne({
            where: { userId },
            order: { createdAt: 'DESC' },
        });

        if (!sub) {
            // Create default free subscription
            sub = this.subscriptionRepository.create({
                userId,
                plan: SubscriptionPlan.FREE,
                status: SubscriptionStatus.ACTIVE,
            });
            await this.subscriptionRepository.save(sub);
        }

        return sub;
    }

    async createSubscription(
        userId: string,
        plan: SubscriptionPlan,
        paymentReference?: string,
    ): Promise<Subscription> {
        if (plan === SubscriptionPlan.FREE) {
            throw new BadRequestException('Cannot subscribe to free plan');
        }

        // Cancel existing active subscription
        await this.subscriptionRepository.update(
            { userId, status: SubscriptionStatus.ACTIVE },
            { status: SubscriptionStatus.CANCELLED },
        );

        // Create new subscription
        const now = new Date();
        const endDate = new Date(now);
        endDate.setMonth(endDate.getMonth() + 1); // 1 month subscription

        const subscription = this.subscriptionRepository.create({
            userId,
            plan,
            status: SubscriptionStatus.ACTIVE,
            startDate: now,
            endDate,
            paymentReference,
        });

        const saved = await this.subscriptionRepository.save(subscription);

        // Invalidate premium cache so swipe limits update immediately
        await this.updateUserPremiumState(userId, true, now, endDate);
        await this.invalidatePremiumCaches(userId);

        return saved;
    }

    async cancelSubscription(userId: string): Promise<void> {
        const sub = await this.subscriptionRepository.findOne({
            where: { userId, status: SubscriptionStatus.ACTIVE },
        });
        if (!sub) throw new NotFoundException('No active subscription found');

        sub.status = SubscriptionStatus.CANCELLED;
        await this.subscriptionRepository.save(sub);

        // Invalidate premium cache
        await this.updateUserPremiumState(userId, false, null, null);
        await this.invalidatePremiumCaches(userId);
    }

    async isPremium(userId: string): Promise<boolean> {
        const state = await this.syncUserPremiumState(userId);
        return state.isPremium;
    }

    async getPlanFeatures(plan: SubscriptionPlan) {
        const features = {
            [SubscriptionPlan.FREE]: {
                dailySwipes: 25,
                seeWhoLikedYou: false,
                advancedFilters: false,
                unlimitedMessages: true,
                profileBoost: false,
                price: 0,
            },
            [SubscriptionPlan.PREMIUM]: {
                dailySwipes: -1, // unlimited
                seeWhoLikedYou: true,
                advancedFilters: true,
                unlimitedMessages: true,
                profileBoost: false,
                price: 9.99,
            },
            [SubscriptionPlan.GOLD]: {
                dailySwipes: -1,
                seeWhoLikedYou: true,
                advancedFilters: true,
                unlimitedMessages: true,
                profileBoost: true,
                price: 19.99,
            },
        };
        return features[plan];
    }

    async setManualPremium(
        userId: string,
        startDate: Date,
        expiryDate: Date,
        paymentReference: string = 'ADMIN_OVERRIDE',
    ): Promise<Subscription> {
        if (expiryDate <= startDate) {
            throw new BadRequestException('expiryDate must be later than startDate');
        }

        await this.subscriptionRepository.update(
            { userId, status: SubscriptionStatus.ACTIVE },
            { status: SubscriptionStatus.CANCELLED },
        );

        const subscription = this.subscriptionRepository.create({
            userId,
            plan: SubscriptionPlan.PREMIUM,
            status: SubscriptionStatus.ACTIVE,
            startDate,
            endDate: expiryDate,
            paymentReference,
        });

        const saved = await this.subscriptionRepository.save(subscription);
        const now = new Date();
        await this.updateUserPremiumState(
            userId,
            startDate <= now && expiryDate > now,
            startDate,
            expiryDate,
        );
        await this.invalidatePremiumCaches(userId);

        return saved;
    }

    async removePremium(userId: string): Promise<void> {
        await this.subscriptionRepository.update(
            { userId, status: SubscriptionStatus.ACTIVE },
            { status: SubscriptionStatus.CANCELLED },
        );

        await this.updateUserPremiumState(userId, false, null, null);
        await this.invalidatePremiumCaches(userId);
    }

    async expirePremiums(now: Date = new Date()): Promise<string[]> {
        const expiredSubscriptions = await this.subscriptionRepository.find({
            where: { status: SubscriptionStatus.ACTIVE },
            select: ['id', 'userId', 'endDate', 'plan'],
        });

        const expiredUserIds = new Set<string>();

        for (const subscription of expiredSubscriptions) {
            if (
                subscription.plan !== SubscriptionPlan.FREE &&
                subscription.endDate &&
                new Date(subscription.endDate) <= now
            ) {
                await this.subscriptionRepository.update(subscription.id, {
                    status: SubscriptionStatus.EXPIRED,
                });
                this.logger.log(
                    `Premium expired for user ${subscription.userId} at ${new Date(subscription.endDate).toISOString()}`,
                );
                expiredUserIds.add(subscription.userId);
            }
        }

        if (expiredUserIds.size === 0) {
            return [];
        }

        const ids = [...expiredUserIds];
        await Promise.all(
            ids.map((userId) => this.updateUserPremiumState(userId, false, null, null)),
        );

        await Promise.all(ids.map((userId) => this.invalidatePremiumCaches(userId)));

        return ids;
    }

    async syncUserPremiumState(
        userId: string,
    ): Promise<{ isPremium: boolean; premiumStartDate: Date | null; premiumExpiryDate: Date | null }> {
        const activeSubscription = await this.subscriptionRepository.findOne({
            where: { userId, status: SubscriptionStatus.ACTIVE },
            order: { endDate: 'DESC', createdAt: 'DESC' },
        });

        const now = new Date();

        if (
            activeSubscription &&
            activeSubscription.plan !== SubscriptionPlan.FREE &&
            (!activeSubscription.startDate || new Date(activeSubscription.startDate) <= now) &&
            (!activeSubscription.endDate || new Date(activeSubscription.endDate) > now)
        ) {
            const startDate = activeSubscription.startDate ? new Date(activeSubscription.startDate) : now;
            const expiryDate = activeSubscription.endDate ? new Date(activeSubscription.endDate) : null;

            await this.updateUserPremiumState(userId, true, startDate, expiryDate);
            await this.invalidatePremiumCaches(userId);

            return {
                isPremium: true,
                premiumStartDate: startDate,
                premiumExpiryDate: expiryDate,
            };
        }

        if (
            activeSubscription &&
            activeSubscription.plan !== SubscriptionPlan.FREE &&
            activeSubscription.startDate &&
            new Date(activeSubscription.startDate) > now
        ) {
            const startDate = new Date(activeSubscription.startDate);
            const expiryDate = activeSubscription.endDate ? new Date(activeSubscription.endDate) : null;

            await this.updateUserPremiumState(userId, false, startDate, expiryDate);
            await this.invalidatePremiumCaches(userId);

            return {
                isPremium: false,
                premiumStartDate: startDate,
                premiumExpiryDate: expiryDate,
            };
        }

        if (activeSubscription?.endDate && new Date(activeSubscription.endDate) <= now) {
            await this.subscriptionRepository.update(activeSubscription.id, {
                status: SubscriptionStatus.EXPIRED,
            });
            this.logger.log(
                `Premium expired for user ${userId} at ${new Date(activeSubscription.endDate).toISOString()}`,
            );
        }

        await this.updateUserPremiumState(userId, false, null, null);
        await this.invalidatePremiumCaches(userId);

        return {
            isPremium: false,
            premiumStartDate: null,
            premiumExpiryDate: null,
        };
    }

    private async updateUserPremiumState(
        userId: string,
        isPremium: boolean,
        premiumStartDate: Date | null,
        premiumExpiryDate: Date | null,
    ): Promise<void> {
        try {
            await this.userRepository.update(userId, {
                isPremium,
                premiumStartDate,
                premiumExpiryDate,
            });
        } catch (error: any) {
            if (this.isMissingPremiumColumnsError(error)) {
                if (!this.hasLoggedMissingPremiumColumns) {
                    this.hasLoggedMissingPremiumColumns = true;
                    this.logger.warn(
                        'users premium columns are missing in the database. Skipping user premium state writes and relying on subscriptions table state.',
                    );
                }
                return;
            }

            throw error;
        }
    }

    private isMissingPremiumColumnsError(error: unknown): boolean {
        if (!error || typeof error !== 'object') {
            return false;
        }

        const message = String((error as { message?: unknown }).message ?? '');
        if (!message.toLowerCase().includes('does not exist')) {
            return false;
        }

        return (
            message.includes('isPremium') ||
            message.includes('premiumStartDate') ||
            message.includes('premiumExpiryDate')
        );
    }

    private async invalidatePremiumCaches(userId: string): Promise<void> {
        await Promise.all([
            this.redisService.del(`premium:${userId}`),
            this.redisService.del(`plan:${userId}`),
            this.redisService.del(`features:${userId}`),
        ]);
    }
}

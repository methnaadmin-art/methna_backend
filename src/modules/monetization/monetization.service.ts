import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { Subscription, SubscriptionPlan, SubscriptionStatus } from '../../database/entities/subscription.entity';
import { Boost, BoostType } from '../../database/entities/boost.entity';
import { RedisService } from '../redis/redis.service';

export enum FeatureFlag {
    UNLIMITED_LIKES = 'unlimited_likes',
    ADVANCED_FILTERS = 'advanced_filters',
    SEE_WHO_LIKED = 'see_who_liked',
    SUPER_LIKE = 'super_like',
    PROFILE_BOOST = 'profile_boost',
    READ_RECEIPTS = 'read_receipts',
    PRIORITY_MATCHING = 'priority_matching',
    REWIND = 'rewind',
}

const PLAN_FEATURES: Record<SubscriptionPlan, FeatureFlag[]> = {
    [SubscriptionPlan.FREE]: [
        FeatureFlag.SUPER_LIKE, // limited to 1/day
    ],
    [SubscriptionPlan.PREMIUM]: [
        FeatureFlag.UNLIMITED_LIKES,
        FeatureFlag.ADVANCED_FILTERS,
        FeatureFlag.SUPER_LIKE,
        FeatureFlag.READ_RECEIPTS,
        FeatureFlag.REWIND,
    ],
    [SubscriptionPlan.GOLD]: [
        FeatureFlag.UNLIMITED_LIKES,
        FeatureFlag.ADVANCED_FILTERS,
        FeatureFlag.SEE_WHO_LIKED,
        FeatureFlag.SUPER_LIKE,
        FeatureFlag.PROFILE_BOOST,
        FeatureFlag.READ_RECEIPTS,
        FeatureFlag.PRIORITY_MATCHING,
        FeatureFlag.REWIND,
    ],
};

const DAILY_LIMITS: Record<SubscriptionPlan, { likes: number; superLikes: number }> = {
    [SubscriptionPlan.FREE]: { likes: 25, superLikes: 1 },
    [SubscriptionPlan.PREMIUM]: { likes: -1, superLikes: 5 }, // -1 = unlimited
    [SubscriptionPlan.GOLD]: { likes: -1, superLikes: -1 },
};

@Injectable()
export class MonetizationService {
    private readonly logger = new Logger(MonetizationService.name);

    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(Subscription)
        private readonly subscriptionRepository: Repository<Subscription>,
        @InjectRepository(Boost)
        private readonly boostRepository: Repository<Boost>,
        private readonly redisService: RedisService,
    ) { }

    // ─── SUBSCRIPTION MANAGEMENT ────────────────────────────

    async getUserPlan(userId: string): Promise<SubscriptionPlan> {
        const cacheKey = `plan:${userId}`;
        const cached = await this.redisService.get(cacheKey);
        if (cached) return cached as SubscriptionPlan;

        const sub = await this.subscriptionRepository.findOne({
            where: { userId, status: SubscriptionStatus.ACTIVE },
            order: { createdAt: 'DESC' },
        });

        const plan = sub?.plan || SubscriptionPlan.FREE;

        // Check expiry
        if (sub && sub.endDate && new Date(sub.endDate) < new Date()) {
            await this.subscriptionRepository.update(sub.id, { status: SubscriptionStatus.EXPIRED });
            await this.redisService.set(cacheKey, SubscriptionPlan.FREE, 3600);
            return SubscriptionPlan.FREE;
        }

        await this.redisService.set(cacheKey, plan, 3600);
        return plan;
    }

    async isPremium(userId: string): Promise<boolean> {
        const plan = await this.getUserPlan(userId);
        return plan !== SubscriptionPlan.FREE;
    }

    async purchaseSubscription(
        userId: string,
        plan: SubscriptionPlan,
        durationDays: number,
        paymentReference: string,
    ): Promise<Subscription> {
        // Cancel existing active subscription
        await this.subscriptionRepository.update(
            { userId, status: SubscriptionStatus.ACTIVE },
            { status: SubscriptionStatus.CANCELLED },
        );

        const startDate = new Date();
        const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

        const sub = this.subscriptionRepository.create({
            userId,
            plan,
            status: SubscriptionStatus.ACTIVE,
            startDate,
            endDate,
            paymentReference,
        });

        const saved = await this.subscriptionRepository.save(sub);

        // Invalidate cache
        await this.redisService.del(`plan:${userId}`);
        await this.redisService.del(`features:${userId}`);

        this.logger.log(`User ${userId} purchased ${plan} for ${durationDays} days`);
        return saved;
    }

    // ─── FEATURE FLAGS ──────────────────────────────────────

    async getUserFeatures(userId: string): Promise<FeatureFlag[]> {
        const cacheKey = `features:${userId}`;
        const cached = await this.redisService.getJson<FeatureFlag[]>(cacheKey);
        if (cached) return cached;

        const plan = await this.getUserPlan(userId);
        const features = PLAN_FEATURES[plan] || [];

        await this.redisService.setJson(cacheKey, features, 3600);
        return features;
    }

    async hasFeature(userId: string, feature: FeatureFlag): Promise<boolean> {
        const features = await this.getUserFeatures(userId);
        return features.includes(feature);
    }

    // ─── DAILY LIMITS ───────────────────────────────────────

    async getDailyLimits(userId: string): Promise<{ likes: number; superLikes: number }> {
        const plan = await this.getUserPlan(userId);
        return DAILY_LIMITS[plan] || DAILY_LIMITS[SubscriptionPlan.FREE];
    }

    async getRemainingLikes(userId: string): Promise<{ remaining: number; limit: number; isUnlimited: boolean }> {
        const limits = await this.getDailyLimits(userId);
        if (limits.likes === -1) {
            return { remaining: -1, limit: -1, isUnlimited: true };
        }

        const today = new Date().toISOString().split('T')[0];
        const usedKey = `likes_used:${userId}:${today}`;
        const used = parseInt(await this.redisService.get(usedKey) || '0', 10);

        return {
            remaining: Math.max(0, limits.likes - used),
            limit: limits.likes,
            isUnlimited: false,
        };
    }

    // ─── BOOST SYSTEM ───────────────────────────────────────

    async purchaseBoost(userId: string, durationMinutes: number = 30): Promise<Boost> {
        // Check for existing active boost
        const activeBoost = await this.boostRepository.findOne({
            where: { userId, isActive: true, expiresAt: MoreThan(new Date()) },
        });

        if (activeBoost) {
            throw new BadRequestException('You already have an active boost');
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + durationMinutes * 60 * 1000);

        const boost = this.boostRepository.create({
            userId,
            type: BoostType.PAID,
            startedAt: now,
            expiresAt,
            isActive: true,
        });

        const saved = await this.boostRepository.save(boost);

        // Update user's boostedUntil field
        await this.userRepository.update(userId, { boostedUntil: expiresAt });

        // Cache boost status
        const ttl = Math.ceil(durationMinutes * 60);
        await this.redisService.set(`boost:${userId}`, '1', ttl);

        this.logger.log(`User ${userId} purchased ${durationMinutes}-minute boost`);
        return saved;
    }

    async isUserBoosted(userId: string): Promise<boolean> {
        const cached = await this.redisService.get(`boost:${userId}`);
        if (cached !== null) return cached === '1';

        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: ['id', 'boostedUntil'],
        });

        return user?.boostedUntil ? new Date(user.boostedUntil) > new Date() : false;
    }

    async getActiveBoost(userId: string): Promise<Boost | null> {
        return this.boostRepository.findOne({
            where: { userId, isActive: true, expiresAt: MoreThan(new Date()) },
        });
    }

    async deactivateExpiredBoosts(): Promise<number> {
        const result = await this.boostRepository
            .createQueryBuilder()
            .update(Boost)
            .set({ isActive: false })
            .where('isActive = true AND expiresAt < :now', { now: new Date() })
            .execute();

        return result.affected || 0;
    }

    // ─── USER STATUS SUMMARY ────────────────────────────────

    async getUserSubscriptionStatus(userId: string) {
        const plan = await this.getUserPlan(userId);
        const features = await this.getUserFeatures(userId);
        const limits = await this.getDailyLimits(userId);
        const remainingLikes = await this.getRemainingLikes(userId);
        const isBoosted = await this.isUserBoosted(userId);
        const activeBoost = isBoosted ? await this.getActiveBoost(userId) : null;

        return {
            plan,
            features,
            limits,
            remainingLikes,
            boost: {
                isActive: isBoosted,
                expiresAt: activeBoost?.expiresAt || null,
            },
        };
    }
}

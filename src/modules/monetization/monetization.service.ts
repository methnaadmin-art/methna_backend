import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { Subscription, SubscriptionPlan, SubscriptionStatus } from '../../database/entities/subscription.entity';
import { Plan } from '../../database/entities/plan.entity';
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
    INVISIBLE_MODE = 'invisible_mode',
    COMPLIMENT_CREDITS = 'compliment_credits',
    REMATCH = 'rematch',
    PREMIUM_BADGE = 'premium_badge',
    HIDE_ADS = 'hide_ads',
    PASSPORT_MODE = 'passport_mode',
    IMPROVED_VISITS = 'improved_visits',
}

/**
 * PDF Spec:
 * FREE: filter age & distance, 10 likes/day, 2 rewinds/month, basic filter
 * PREMIUM: unlimited likes, see who likes you, free daily compliment credit,
 *   4 weekly profile boosts, unlimited rewind, request rematch, improve daily visits,
 *   invisible mode, premium badge, hide ads, passport mode
 * GOLD (Elite - future): all premium + video chat
 */
// Default limits if no plan is found in DB
const DEFAULT_FREE_FEATURES = [FeatureFlag.PASSPORT_MODE];
const DEFAULT_FREE_LIMITS = { likes: 10, superLikes: 0, complimentCredits: 0 };
const DEFAULT_FREE_MONTHLY_LIMITS = { rewinds: 2, weeklyBoosts: 0 };

@Injectable()
export class MonetizationService {
    private readonly logger = new Logger(MonetizationService.name);

    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(Subscription)
        private readonly subscriptionRepository: Repository<Subscription>,
        @InjectRepository(Plan)
        private readonly planRepository: Repository<Plan>,
        @InjectRepository(Boost)
        private readonly boostRepository: Repository<Boost>,
        private readonly redisService: RedisService,
    ) { }

    // ─── SUBSCRIPTION MANAGEMENT ────────────────────────────
    
    async getEffectivePlan(userId: string): Promise<Plan | null> {
        const sub = await this.subscriptionRepository.findOne({
            where: { userId, status: SubscriptionStatus.ACTIVE },
            order: { createdAt: 'DESC' },
            relations: ['planEntity'],
        });

        if (sub && sub.endDate && new Date(sub.endDate) < new Date()) {
            await this.subscriptionRepository.update(sub.id, { status: SubscriptionStatus.EXPIRED });
            await this.userRepository.update(userId, {
                isPremium: false,
                premiumStartDate: null,
                premiumExpiryDate: null,
            });
            await this.redisService.del(`premium:${userId}`);
            await this.redisService.del(`plan:${userId}`);
            await this.redisService.del(`features:${userId}`);
            return this.planRepository.findOne({ where: { name: 'BASIC' } });
        }

        if (sub && sub.planEntity) {
            return sub.planEntity;
        }

        return this.planRepository.findOne({ where: { name: 'BASIC' } }); // default fallback
    }

    async getUserPlan(userId: string): Promise<string> {
        const cacheKey = `plan:${userId}`;
        const cached = await this.redisService.get(cacheKey);
        if (cached) return cached;

        const effectivePlan = await this.getEffectivePlan(userId);
        const planName = effectivePlan?.name?.toLowerCase() || 'free';

        await this.redisService.set(cacheKey, planName, 3600);
        return planName;
    }

    async isPremium(userId: string): Promise<boolean> {
        const plan = await this.getUserPlan(userId);
        return plan !== 'free' && plan !== 'basic';
    }

    async purchaseSubscription(
        userId: string,
        planName: string,
        durationDays: number,
        paymentReference: string,
    ): Promise<Subscription> {
        const planEntity = await this.planRepository.findOne({ where: { name: planName.toUpperCase() } });
        if (!planEntity) throw new BadRequestException('Plan not found');

        // Cancel existing active subscription
        await this.subscriptionRepository.update(
            { userId, status: SubscriptionStatus.ACTIVE },
            { status: SubscriptionStatus.CANCELLED },
        );

        const startDate = new Date();
        const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

        const sub = this.subscriptionRepository.create({
            userId,
            planId: planEntity.id,
            planEntity,
            status: SubscriptionStatus.ACTIVE,
            startDate,
            endDate,
            paymentReference,
        });

        const saved = await this.subscriptionRepository.save(sub);

        await this.userRepository.update(userId, {
            isPremium: true,
            premiumStartDate: startDate,
            premiumExpiryDate: endDate,
        });

        // Invalidate cache
        await this.redisService.del(`plan:${userId}`);
        await this.redisService.del(`features:${userId}`);
        await this.redisService.del(`premium:${userId}`);

        this.logger.log(`User ${userId} purchased plan ${planEntity.name} for ${durationDays} days`);
        return saved;
    }

    // ─── GET ACTIVE PLANS ───────────────────────────────────
    async getActivePlans(): Promise<Plan[]> {
        return this.planRepository.find({ 
            where: { isActive: true },
            order: { price: 'ASC' }
        });
    }

    // ─── FEATURE FLAGS ──────────────────────────────────────

    async getUserFeatures(userId: string): Promise<FeatureFlag[]> {
        const cacheKey = `features:${userId}`;
        const cached = await this.redisService.getJson<FeatureFlag[]>(cacheKey);
        if (cached) return cached;

        const effectivePlan = await this.getEffectivePlan(userId);
        const features: FeatureFlag[] = (effectivePlan?.features || DEFAULT_FREE_FEATURES) as FeatureFlag[];

        await this.redisService.setJson(cacheKey, features, 3600);
        return features;
    }

    async hasFeature(userId: string, feature: FeatureFlag): Promise<boolean> {
        const features = await this.getUserFeatures(userId);
        return features.includes(feature);
    }

    // ─── DAILY LIMITS ───────────────────────────────────────

    async getDailyLimits(userId: string): Promise<{ likes: number; superLikes: number; complimentCredits: number }> {
        const plan = await this.getEffectivePlan(userId);
        if (!plan) return DEFAULT_FREE_LIMITS;
        return {
            likes: plan.dailyLikesLimit,
            superLikes: plan.dailySuperLikesLimit,
            complimentCredits: plan.dailyComplimentsLimit,
        };
    }

    async getMonthlyLimits(userId: string): Promise<{ rewinds: number; weeklyBoosts: number }> {
        const plan = await this.getEffectivePlan(userId);
        if (!plan) return DEFAULT_FREE_MONTHLY_LIMITS;
        return {
            rewinds: plan.monthlyRewindsLimit,
            weeklyBoosts: plan.weeklyBoostsLimit,
        };
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

    // ─── REWIND TRACKING ─────────────────────────────────────

    async canRewind(userId: string): Promise<boolean> {
        const monthlyLimits = await this.getMonthlyLimits(userId);
        if (monthlyLimits.rewinds === -1) return true; // unlimited

        const month = new Date().toISOString().slice(0, 7); // YYYY-MM
        const usedKey = `rewinds_used:${userId}:${month}`;
        const used = parseInt(await this.redisService.get(usedKey) || '0', 10);
        return used < monthlyLimits.rewinds;
    }

    async useRewind(userId: string): Promise<{ success: boolean; remaining: number }> {
        const monthlyLimits = await this.getMonthlyLimits(userId);

        if (monthlyLimits.rewinds === -1) {
            return { success: true, remaining: -1 };
        }

        const month = new Date().toISOString().slice(0, 7);
        const usedKey = `rewinds_used:${userId}:${month}`;
        const used = parseInt(await this.redisService.get(usedKey) || '0', 10);

        if (used >= monthlyLimits.rewinds) {
            throw new BadRequestException('No rewinds remaining this month. Upgrade to Premium for unlimited rewinds.');
        }

        await this.redisService.set(usedKey, String(used + 1), 31 * 24 * 3600); // 31 days TTL
        return { success: true, remaining: monthlyLimits.rewinds - used - 1 };
    }

    // ─── COMPLIMENT CREDITS ──────────────────────────────────

    async getRemainingCompliments(userId: string): Promise<{ remaining: number; limit: number; isUnlimited: boolean }> {
        const limits = await this.getDailyLimits(userId);
        if (limits.complimentCredits === 0) {
            return { remaining: 0, limit: 0, isUnlimited: false };
        }
        if (limits.complimentCredits === -1) {
            return { remaining: -1, limit: -1, isUnlimited: true };
        }

        const today = new Date().toISOString().split('T')[0];
        const usedKey = `compliments_used:${userId}:${today}`;
        const used = parseInt(await this.redisService.get(usedKey) || '0', 10);
        return {
            remaining: Math.max(0, limits.complimentCredits - used),
            limit: limits.complimentCredits,
            isUnlimited: false,
        };
    }

    async useComplimentCredit(userId: string): Promise<void> {
        const remaining = await this.getRemainingCompliments(userId);
        if (remaining.remaining === 0 && !remaining.isUnlimited) {
            throw new BadRequestException('No compliment credits remaining today.');
        }

        const today = new Date().toISOString().split('T')[0];
        const usedKey = `compliments_used:${userId}:${today}`;
        const used = parseInt(await this.redisService.get(usedKey) || '0', 10);
        await this.redisService.set(usedKey, String(used + 1), 24 * 3600);
    }

    // ─── INVISIBLE MODE ──────────────────────────────────────

    async toggleInvisibleMode(userId: string, enabled: boolean): Promise<void> {
        const canUse = await this.hasFeature(userId, FeatureFlag.INVISIBLE_MODE);
        if (!canUse) {
            throw new BadRequestException('Invisible mode is a Premium feature.');
        }
        await this.redisService.set(`invisible:${userId}`, enabled ? '1' : '0', 0);
    }

    async isInvisible(userId: string): Promise<boolean> {
        const val = await this.redisService.get(`invisible:${userId}`);
        return val === '1';
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

    // ─── PASSPORT MODE (Virtual Location) ──────────────────

    async setPassportLocation(
        userId: string,
        latitude: number,
        longitude: number,
        city?: string,
        country?: string,
    ): Promise<void> {
        const canUse = await this.hasFeature(userId, FeatureFlag.PASSPORT_MODE);
        if (!canUse) {
            throw new BadRequestException('Passport mode is not available on your plan.');
        }

        const passportData = JSON.stringify({ latitude, longitude, city, country });
        await this.redisService.set(`passport:${userId}`, passportData, 0); // No expiry
        this.logger.log(`User ${userId} set passport location: ${city || ''}, ${country || ''}`);
    }

    async clearPassportLocation(userId: string): Promise<void> {
        await this.redisService.del(`passport:${userId}`);
        this.logger.log(`User ${userId} cleared passport location`);
    }

    async getPassportLocation(userId: string): Promise<{ latitude: number; longitude: number; city?: string; country?: string } | null> {
        const data = await this.redisService.get(`passport:${userId}`);
        if (!data) return null;
        try {
            return JSON.parse(data);
        } catch {
            return null;
        }
    }

    async getEffectiveLocation(userId: string): Promise<{ latitude: number; longitude: number; city?: string; country?: string } | null> {
        // Passport mode overrides real location
        const passport = await this.getPassportLocation(userId);
        if (passport) return passport;
        return null; // Caller should fall back to profile location
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

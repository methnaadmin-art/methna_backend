import {
    Injectable,
    Logger,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { Profile } from '../../database/entities/profile.entity';
import { Subscription, SubscriptionStatus } from '../../database/entities/subscription.entity';
import { Plan, PlanEntitlements } from '../../database/entities/plan.entity';
import { Boost, BoostType } from '../../database/entities/boost.entity';
import { RedisService } from '../redis/redis.service';
import { PlansService } from '../plans/plans.service';
import { ConsumableService } from '../consumables/consumable.service';

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
    GHOST_MODE = 'ghost_mode',
    COMPLIMENT_CREDITS = 'compliment_credits',
    REMATCH = 'rematch',
    PREMIUM_BADGE = 'premium_badge',
    HIDE_ADS = 'hide_ads',
    PASSPORT_MODE = 'passport_mode',
    IMPROVED_VISITS = 'improved_visits',
    VIDEO_CHAT = 'video_chat',
    TYPING_INDICATORS = 'typing_indicators',
}

const FEATURE_TO_ENTITLEMENT: Partial<Record<FeatureFlag, keyof PlanEntitlements>> = {
    [FeatureFlag.UNLIMITED_LIKES]: 'unlimitedLikes',
    [FeatureFlag.ADVANCED_FILTERS]: 'advancedFilters',
    [FeatureFlag.SEE_WHO_LIKED]: 'seeWhoLikesYou',
    [FeatureFlag.SUPER_LIKE]: 'superLike',
    [FeatureFlag.PROFILE_BOOST]: 'weeklyBoosts',
    [FeatureFlag.READ_RECEIPTS]: 'readReceipts',
    [FeatureFlag.PRIORITY_MATCHING]: 'priorityMatching',
    [FeatureFlag.REWIND]: 'monthlyRewinds',
    [FeatureFlag.INVISIBLE_MODE]: 'invisibleMode',
    [FeatureFlag.GHOST_MODE]: 'ghostMode',
    [FeatureFlag.COMPLIMENT_CREDITS]: 'dailyCompliments',
    [FeatureFlag.REMATCH]: 'rematch',
    [FeatureFlag.PREMIUM_BADGE]: 'premiumBadge',
    [FeatureFlag.HIDE_ADS]: 'hideAds',
    [FeatureFlag.PASSPORT_MODE]: 'passportMode',
    [FeatureFlag.IMPROVED_VISITS]: 'improvedVisits',
    [FeatureFlag.VIDEO_CHAT]: 'videoChat',
    [FeatureFlag.TYPING_INDICATORS]: 'typingIndicators',
};

const DEFAULT_LIMITS = {
    likes: 10,
    superLikes: 0,
    complimentCredits: 0,
    rewinds: 2,
    weeklyBoosts: 0,
};

@Injectable()
export class MonetizationService {
    private readonly logger = new Logger(MonetizationService.name);

    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(Profile)
        private readonly profileRepository: Repository<Profile>,
        @InjectRepository(Subscription)
        private readonly subscriptionRepository: Repository<Subscription>,
        @InjectRepository(Plan)
        private readonly planRepository: Repository<Plan>,
        @InjectRepository(Boost)
        private readonly boostRepository: Repository<Boost>,
        private readonly redisService: RedisService,
        private readonly plansService: PlansService,
        private readonly consumableService: ConsumableService,
    ) { }

    async getEffectivePlan(userId: string): Promise<Plan | null> {
        const { plan } = await this.plansService.resolveUserEntitlements(userId);
        return plan;
    }

    async getUserPlan(userId: string): Promise<string> {
        const cacheKey = `plan:${userId}`;
        const cached = await this.redisService.get(cacheKey);
        if (cached) return cached;

        const { plan } = await this.plansService.resolveUserEntitlements(userId);
        const planCode = plan?.code || 'free';

        await this.redisService.set(cacheKey, planCode, 3600);
        return planCode;
    }

    async isPremium(userId: string): Promise<boolean> {
        const { plan, subscription } = await this.plansService.resolveUserEntitlements(userId);
        const isActive = subscription?.status === SubscriptionStatus.ACTIVE ||
            subscription?.status === SubscriptionStatus.PENDING_CANCELLATION ||
            subscription?.status === SubscriptionStatus.PAST_DUE;
        return !!isActive && plan.code !== 'free';
    }

    /**
     * Backward-compatible no-payment activation endpoint.
     * Paid plans must be activated by the Stripe checkout webhook.
     */
    async purchaseSubscription(
        userId: string,
        planRef: string,
        durationDays?: number,
        paymentReference?: string,
    ): Promise<Subscription> {
        const planEntity = await this.findVisiblePlan(planRef);
        if (!planEntity) throw new BadRequestException('Plan not found, inactive, or hidden');
        if (Number(planEntity.price) > 0) {
            throw new BadRequestException('Paid plans must be activated through checkout/webhook.');
        }

        await this.subscriptionRepository.update(
            { userId, status: SubscriptionStatus.ACTIVE },
            { status: SubscriptionStatus.CANCELLED },
        );
        await this.subscriptionRepository.update(
            { userId, status: SubscriptionStatus.PENDING_CANCELLATION },
            { status: SubscriptionStatus.CANCELLED },
        );

        const startDate = new Date();
        const endDate = new Date(startDate.getTime() + (durationDays || planEntity.durationDays || 30) * 24 * 60 * 60 * 1000);

        const sub = this.subscriptionRepository.create({
            userId,
            plan: planEntity.code,
            planId: planEntity.id,
            planEntity,
            status: SubscriptionStatus.ACTIVE,
            startDate,
            endDate,
            paymentReference: paymentReference || 'NO_PAYMENT_PLAN',
            billingCycle: planEntity.billingCycle,
            paymentProvider: 'trial',
        });

        const saved = await this.subscriptionRepository.save(sub);
        await this.userRepository.update(userId, {
            isPremium: planEntity.code !== 'free',
            premiumStartDate: startDate,
            premiumExpiryDate: endDate,
            subscriptionPlanId: planEntity.id,
        });
        await this.invalidateUserPlanCaches(userId);

        this.logger.log(`User ${userId} activated plan ${planEntity.code}`);
        return saved;
    }

    async getActivePlans(): Promise<Plan[]> {
        return this.plansService.getPublicPlans();
    }

    async getUserFeatures(userId: string): Promise<FeatureFlag[]> {
        const cacheKey = `features:${userId}`;
        const cached = await this.redisService.getJson<FeatureFlag[]>(cacheKey);
        if (cached) return cached;

        const { plan, entitlements } = await this.plansService.resolveUserEntitlements(userId);
        const features = new Set<FeatureFlag>((plan.features || []) as FeatureFlag[]);

        for (const feature of Object.values(FeatureFlag)) {
            if (this.entitlementEnablesFeature(entitlements, feature)) {
                features.add(feature);
            }
        }

        const result = [...features];
        await this.redisService.setJson(cacheKey, result, 3600);
        return result;
    }

    async hasFeature(userId: string, feature: FeatureFlag): Promise<boolean> {
        const { plan, entitlements } = await this.plansService.resolveUserEntitlements(userId);
        const planFeatures = (plan.features || []).map((item) => String(item));
        const hasPlanFeature =
            planFeatures.includes(feature) ||
            (feature === FeatureFlag.GHOST_MODE && planFeatures.includes(FeatureFlag.INVISIBLE_MODE)) ||
            (feature === FeatureFlag.INVISIBLE_MODE && planFeatures.includes(FeatureFlag.GHOST_MODE));

        return this.entitlementEnablesFeature(entitlements, feature) || hasPlanFeature;
    }

    async getDailyLimits(userId: string): Promise<{ likes: number; superLikes: number; complimentCredits: number }> {
        const { entitlements } = await this.plansService.resolveUserEntitlements(userId);
        const likes = entitlements.unlimitedLikes
            ? -1
            : this.numberEntitlementFromAliases(
                entitlements,
                ['dailyLikes', 'likesLimit'],
                DEFAULT_LIMITS.likes,
            );
        const superLikes = this.numberEntitlement(
            entitlements.dailySuperLikes,
            entitlements.superLike ? -1 : DEFAULT_LIMITS.superLikes,
        );
        const complimentCredits = this.numberEntitlementFromAliases(
            entitlements,
            ['dailyCompliments', 'complimentsLimit'],
            DEFAULT_LIMITS.complimentCredits,
        );

        return { likes, superLikes, complimentCredits };
    }

    async getMonthlyLimits(userId: string): Promise<{ rewinds: number; weeklyBoosts: number }> {
        const { entitlements } = await this.plansService.resolveUserEntitlements(userId);
        const rewinds = entitlements.unlimitedRewinds
            ? -1
            : this.numberEntitlement(entitlements.monthlyRewinds, DEFAULT_LIMITS.rewinds);
        const weeklyBoosts = this.numberEntitlementFromAliases(
            entitlements,
            ['weeklyBoosts', 'boostsLimit'],
            DEFAULT_LIMITS.weeklyBoosts,
        );

        return { rewinds, weeklyBoosts };
    }

    async getRemainingLikes(userId: string): Promise<{ remaining: number; limit: number; isUnlimited: boolean; consumableBalance: number }> {
        const { likes } = await this.getDailyLimits(userId);
        const dailyResult = await this.getRemainingDailyCounter(`likes_used:${userId}:${this.todayKey()}`, likes);
        const balances = await this.consumableService.getUserBalances(userId);
        return {
            ...dailyResult,
            remaining: dailyResult.remaining + balances.likes,
            consumableBalance: balances.likes,
        };
    }

    async useLike(userId: string): Promise<{ success: boolean; remaining: number }> {
        // Try consumable balance first
        const balanceResult = await this.consumableService.consumeBalance(userId, 'likes', 1);
        if (balanceResult.success) {
            return { success: true, remaining: balanceResult.remaining };
        }

        // Fall back to subscription-based daily limit
        const { likes } = await this.getDailyLimits(userId);
        return this.consumeCounter(
            `likes_used:${userId}:${this.todayKey()}`,
            likes,
            24 * 3600,
            'Daily like limit reached. Upgrade your plan for more likes.',
        );
    }

    async getRemainingSuperLikes(userId: string): Promise<{ remaining: number; limit: number; isUnlimited: boolean }> {
        const { superLikes } = await this.getDailyLimits(userId);
        return this.getRemainingDailyCounter(`superlikes_used:${userId}:${this.todayKey()}`, superLikes);
    }

    async useSuperLike(userId: string): Promise<{ success: boolean; remaining: number }> {
        const { superLikes } = await this.getDailyLimits(userId);
        return this.consumeCounter(
            `superlikes_used:${userId}:${this.todayKey()}`,
            superLikes,
            24 * 3600,
            'No super likes remaining on your current plan.',
        );
    }

    async canRewind(userId: string): Promise<boolean> {
        const monthlyLimits = await this.getMonthlyLimits(userId);
        if (monthlyLimits.rewinds === -1) return true;

        const used = parseInt(await this.redisService.get(`rewinds_used:${userId}:${this.monthKey()}`) || '0', 10);
        return used < monthlyLimits.rewinds;
    }

    async useRewind(userId: string): Promise<{ success: boolean; remaining: number }> {
        const monthlyLimits = await this.getMonthlyLimits(userId);
        return this.consumeCounter(
            `rewinds_used:${userId}:${this.monthKey()}`,
            monthlyLimits.rewinds,
            31 * 24 * 3600,
            'No rewinds remaining this month.',
        );
    }

    async getRemainingCompliments(userId: string): Promise<{ remaining: number; limit: number; isUnlimited: boolean; consumableBalance: number }> {
        const limits = await this.getDailyLimits(userId);
        const dailyResult = await this.getRemainingDailyCounter(
            `compliments_used:${userId}:${this.todayKey()}`,
            limits.complimentCredits,
        );
        const balances = await this.consumableService.getUserBalances(userId);
        return {
            ...dailyResult,
            remaining: dailyResult.remaining + balances.compliments,
            consumableBalance: balances.compliments,
        };
    }

    async useComplimentCredit(userId: string): Promise<void> {
        // Try consumable balance first
        const balanceResult = await this.consumableService.consumeBalance(userId, 'compliments', 1);
        if (balanceResult.success) {
            return;
        }

        // Fall back to subscription-based daily limit
        await this.consumeCounter(
            `compliments_used:${userId}:${this.todayKey()}`,
            (await this.getDailyLimits(userId)).complimentCredits,
            24 * 3600,
            'No compliment credits remaining today.',
        );
    }

    async toggleInvisibleMode(userId: string, enabled: boolean): Promise<void> {
        const canUseGhostMode =
            (await this.hasFeature(userId, FeatureFlag.INVISIBLE_MODE)) ||
            (await this.hasFeature(userId, FeatureFlag.GHOST_MODE));
        if (!canUseGhostMode) {
            throw new BadRequestException('Invisible mode is not available on your current plan.');
        }

        await this.userRepository.update(userId, { isGhostModeEnabled: enabled });
        await this.redisService.set(`invisible:${userId}`, enabled ? '1' : '0', 0);
        await this.redisService.delByPattern('search:*');
        await this.redisService.delByPattern('discovery:*');
        await this.redisService.delByPattern('suggestions:*');
    }

    async isInvisible(userId: string): Promise<boolean> {
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: {
                id: true,
                isGhostModeEnabled: true,
            },
        });
        if (user) {
            return user.isGhostModeEnabled === true;
        }

        const val = await this.redisService.get(`invisible:${userId}`);
        return val === '1';
    }

    async purchaseBoost(userId: string, durationMinutes: number = 30): Promise<Boost> {
        const activeBoost = await this.boostRepository.findOne({
            where: { userId, isActive: true, expiresAt: MoreThan(new Date()) },
        });
        if (activeBoost) throw new BadRequestException('You already have an active boost');

        // Try consumable balance first
        const balanceResult = await this.consumableService.activateBoost(userId, durationMinutes);
        if (balanceResult.success && balanceResult.boost) {
            return balanceResult.boost;
        }

        // Fall back to subscription-based weekly boost limit
        const monthlyLimits = await this.getMonthlyLimits(userId);
        await this.consumeCounter(
            `boosts_used:${userId}:${this.weekKey()}`,
            monthlyLimits.weeklyBoosts,
            8 * 24 * 3600,
            'No boosts remaining this week on your current plan.',
        );

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
        await this.userRepository.update(userId, { boostedUntil: expiresAt });
        await this.redisService.set(`boost:${userId}`, '1', Math.ceil(durationMinutes * 60));

        this.logger.log(`User ${userId} activated a ${durationMinutes}-minute boost`);
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

    async setPassportLocation(
        userId: string,
        latitude: number,
        longitude: number,
        city?: string,
        country?: string,
    ): Promise<void> {
        if (!(await this.hasFeature(userId, FeatureFlag.PASSPORT_MODE))) {
            throw new BadRequestException('Passport mode is not available on your current plan.');
        }

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            throw new BadRequestException('A valid latitude/longitude is required for passport mode.');
        }

        const normalizedCity = city?.trim() || undefined;
        const normalizedCountry = country?.trim() || undefined;
        if (!normalizedCity && !normalizedCountry) {
            throw new BadRequestException('Passport mode requires at least a city or country.');
        }

        const [user, profile] = await Promise.all([
            this.userRepository.findOne({
                where: { id: userId },
                select: {
                    id: true,
                    realLocation: true,
                },
            }),
            this.profileRepository.findOne({
                where: { userId },
                select: {
                    id: true,
                    latitude: true,
                    longitude: true,
                    city: true,
                    country: true,
                },
            }),
        ]);

        if (!user) {
            throw new BadRequestException('User not found');
        }

        const existingRealLocation =
            user.realLocation && typeof user.realLocation === 'object'
                ? user.realLocation
                : null;
        const derivedRealLocation = {
            latitude: profile?.latitude ?? undefined,
            longitude: profile?.longitude ?? undefined,
            city: profile?.city ?? undefined,
            country: profile?.country ?? undefined,
        };

        const passportLocation = {
            latitude,
            longitude,
            city: normalizedCity,
            country: normalizedCountry,
        };

        // Maintain normalized numeric columns for efficient SQL filtering
        // (avoids regex/JSON parsing inside search queries).
        const normalizedLat =
            Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 ? latitude : null;
        const normalizedLng =
            Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 ? longitude : null;

        await this.userRepository.update(userId, {
            isPassportActive: true,
            passportLocation,
            passportLatitude: normalizedLat,
            passportLongitude: normalizedLng,
            realLocation: existingRealLocation ?? (this.hasLocationValues(derivedRealLocation) ? derivedRealLocation : null),
        });

        const passportData = JSON.stringify(passportLocation);
        await this.redisService.set(`passport:${userId}`, passportData, 0);
        await this.redisService.delByPattern('search:*');
        await this.redisService.delByPattern('discovery:*');
        await this.redisService.delByPattern('suggestions:*');

        this.logger.log(`User ${userId} set passport location: ${normalizedCity || ''}, ${normalizedCountry || ''}`);
    }

    async clearPassportLocation(userId: string): Promise<void> {
        await this.userRepository.update(userId, {
            isPassportActive: false,
            passportLocation: null,
            passportLatitude: null,
            passportLongitude: null,
        });
        await this.redisService.del(`passport:${userId}`);
        await this.redisService.delByPattern('search:*');
        await this.redisService.delByPattern('discovery:*');
        await this.redisService.delByPattern('suggestions:*');
        this.logger.log(`User ${userId} cleared passport location`);
    }

    async getPassportLocation(userId: string): Promise<{ latitude?: number; longitude?: number; city?: string; country?: string } | null> {
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: {
                id: true,
                isPassportActive: true,
                passportLocation: true,
            },
        });

        if (user?.isPassportActive === true && user.passportLocation) {
            return user.passportLocation;
        }

        const data = await this.redisService.get(`passport:${userId}`);
        if (!data) return null;
        try {
            return JSON.parse(data);
        } catch {
            return null;
        }
    }

    async getEffectiveLocation(userId: string): Promise<{ latitude?: number; longitude?: number; city?: string; country?: string } | null> {
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: {
                id: true,
                isPassportActive: true,
                passportLocation: true,
                realLocation: true,
            },
        });

        if (user?.isPassportActive === true && user.passportLocation) {
            return user.passportLocation;
        }

        return user?.realLocation ?? null;
    }

    async getUserSubscriptionStatus(userId: string) {
        const { plan, entitlements, subscription } = await this.plansService.resolveUserEntitlements(userId);
        const features = await this.getUserFeatures(userId);
        const limits = await this.getDailyLimits(userId);
        const monthlyLimits = await this.getMonthlyLimits(userId);
        const remainingLikes = await this.getRemainingLikes(userId);
        const isBoosted = await this.isUserBoosted(userId);
        const activeBoost = isBoosted ? await this.getActiveBoost(userId) : null;
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: {
                id: true,
                isGhostModeEnabled: true,
                isPassportActive: true,
                passportLocation: true,
                realLocation: true,
                subscriptionPlanId: true,
            },
        });

        const planFeatures = {
            advancedFilters:
                this.entitlementEnablesFeature(entitlements, FeatureFlag.ADVANCED_FILTERS) ||
                features.includes(FeatureFlag.ADVANCED_FILTERS),
            boost:
                this.entitlementEnablesFeature(entitlements, FeatureFlag.PROFILE_BOOST) ||
                features.includes(FeatureFlag.PROFILE_BOOST),
            likes:
                this.entitlementEnablesFeature(entitlements, FeatureFlag.UNLIMITED_LIKES) ||
                this.numberEntitlementFromAliases(entitlements, ['dailyLikes', 'likesLimit'], 0) !== 0,
            whoLikedMe:
                this.entitlementEnablesFeature(entitlements, FeatureFlag.SEE_WHO_LIKED) ||
                features.includes(FeatureFlag.SEE_WHO_LIKED),
            ghostMode:
                this.entitlementEnablesFeature(entitlements, FeatureFlag.GHOST_MODE) ||
                this.entitlementEnablesFeature(entitlements, FeatureFlag.INVISIBLE_MODE) ||
                features.includes(FeatureFlag.GHOST_MODE) ||
                features.includes(FeatureFlag.INVISIBLE_MODE),
            passportMode:
                this.entitlementEnablesFeature(entitlements, FeatureFlag.PASSPORT_MODE) ||
                features.includes(FeatureFlag.PASSPORT_MODE),
            compliments:
                this.entitlementEnablesFeature(entitlements, FeatureFlag.COMPLIMENT_CREDITS) ||
                features.includes(FeatureFlag.COMPLIMENT_CREDITS),
            premiumBadge:
                this.entitlementEnablesFeature(entitlements, FeatureFlag.PREMIUM_BADGE) ||
                features.includes(FeatureFlag.PREMIUM_BADGE),
            likesLimit: this.numberEntitlementFromAliases(entitlements, ['dailyLikes', 'likesLimit'], DEFAULT_LIMITS.likes),
            boostsLimit: this.numberEntitlementFromAliases(entitlements, ['weeklyBoosts', 'boostsLimit'], DEFAULT_LIMITS.weeklyBoosts),
            complimentsLimit: this.numberEntitlementFromAliases(entitlements, ['dailyCompliments', 'complimentsLimit'], DEFAULT_LIMITS.complimentCredits),
        };

        return {
            plan: plan.code,
            planId: plan.id,
            subscriptionPlanId: user?.subscriptionPlanId ?? plan.id,
            status: subscription?.status ?? 'free',
            paymentProvider: subscription?.paymentProvider ?? null,
            entitlements,
            features,
            planFeatures,
            limits,
            monthlyLimits,
            remainingLikes,
            visibility: {
                isGhostModeEnabled: user?.isGhostModeEnabled ?? false,
                isPassportActive: user?.isPassportActive ?? false,
                passportLocation: user?.passportLocation ?? null,
                realLocation: user?.realLocation ?? null,
            },
            boost: {
                isActive: isBoosted,
                expiresAt: activeBoost?.expiresAt || null,
            },
        };
    }

    private entitlementEnablesFeature(entitlements: PlanEntitlements, feature: FeatureFlag): boolean {
        if (feature === FeatureFlag.REWIND) {
            return entitlements.unlimitedRewinds === true || this.numberEntitlement(entitlements.monthlyRewinds, 0) !== 0;
        }
        if (feature === FeatureFlag.PROFILE_BOOST) {
            return this.numberEntitlementFromAliases(entitlements, ['weeklyBoosts', 'boostsLimit'], 0) !== 0 ||
                entitlements.profileBoostPriority === true;
        }
        if (feature === FeatureFlag.SUPER_LIKE) {
            return entitlements.superLike === true ||
                this.numberEntitlement(entitlements.dailySuperLikes, 0) !== 0;
        }
        if (feature === FeatureFlag.SEE_WHO_LIKED) {
            return entitlements.seeWhoLikesYou === true || entitlements.whoLikedMe === true;
        }
        if (feature === FeatureFlag.INVISIBLE_MODE || feature === FeatureFlag.GHOST_MODE) {
            return entitlements.invisibleMode === true || entitlements.ghostMode === true;
        }
        if (feature === FeatureFlag.COMPLIMENT_CREDITS) {
            return this.numberEntitlementFromAliases(entitlements, ['dailyCompliments', 'complimentsLimit'], 0) !== 0;
        }

        const key = FEATURE_TO_ENTITLEMENT[feature];
        if (!key) return false;
        const value = entitlements[key];
        return value === true || value === -1 || (typeof value === 'number' && value > 0);
    }

    private numberEntitlementFromAliases(
        entitlements: PlanEntitlements,
        keys: Array<keyof PlanEntitlements>,
        fallback: number,
    ): number {
        for (const key of keys) {
            const value = entitlements[key] as unknown;
            if (value === -1) return -1;
            if (typeof value === 'number' && Number.isFinite(value)) return value;
            if (typeof value === 'string' && value.trim() !== '') {
                const parsed = Number(value);
                if (Number.isFinite(parsed)) {
                    return parsed;
                }
            }
        }
        return fallback;
    }

    private numberEntitlement(value: unknown, fallback: number): number {
        if (value === -1) return -1;
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string' && value.trim() !== '') {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : fallback;
        }
        return fallback;
    }

    private async getRemainingDailyCounter(key: string, limit: number): Promise<{ remaining: number; limit: number; isUnlimited: boolean }> {
        if (limit === -1) return { remaining: -1, limit: -1, isUnlimited: true };
        const used = parseInt(await this.redisService.get(key) || '0', 10);
        return { remaining: Math.max(0, limit - used), limit, isUnlimited: false };
    }

    private async consumeCounter(
        key: string,
        limit: number,
        ttlSeconds: number,
        errorMessage: string,
    ): Promise<{ success: boolean; remaining: number }> {
        if (limit === -1) return { success: true, remaining: -1 };
        if (limit <= 0) throw new ForbiddenException(errorMessage);

        const used = parseInt(await this.redisService.get(key) || '0', 10);
        if (used >= limit) throw new ForbiddenException(errorMessage);

        const next = used + 1;
        await this.redisService.set(key, String(next), ttlSeconds);
        return { success: true, remaining: Math.max(0, limit - next) };
    }

    private async findVisiblePlan(planRef: string): Promise<Plan | null> {
        const normalized = (planRef || '').trim();
        if (!normalized) return null;
        const byCode = { code: normalized, isActive: true, isVisible: true };
        if (!this.isUuid(normalized)) {
            return this.planRepository.findOne({ where: byCode });
        }
        return this.planRepository.findOne({
            where: [
                { id: normalized, isActive: true, isVisible: true },
                byCode,
            ],
        });
    }

    private isUuid(value: string): boolean {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    }

    private async invalidateUserPlanCaches(userId: string): Promise<void> {
        await Promise.all([
            this.redisService.del(`plan:${userId}`),
            this.redisService.del(`features:${userId}`),
            this.redisService.del(`premium:${userId}`),
            this.redisService.del(`entitlements:${userId}`),
        ]);
    }

    private hasLocationValues(location: {
        latitude?: number;
        longitude?: number;
        city?: string;
        country?: string;
    }): boolean {
        return (
            Number.isFinite(location.latitude) ||
            Number.isFinite(location.longitude) ||
            (location.city ?? '').trim().length > 0 ||
            (location.country ?? '').trim().length > 0
        );
    }

    private todayKey(): string {
        return new Date().toISOString().split('T')[0];
    }

    private monthKey(): string {
        return new Date().toISOString().slice(0, 7);
    }

    private weekKey(): string {
        const now = new Date();
        const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
        const day = Math.floor((now.getTime() - start.getTime()) / 86400000);
        const week = Math.ceil((day + start.getUTCDay() + 1) / 7);
        return `${now.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
    }
}

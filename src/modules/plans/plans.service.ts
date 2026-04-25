import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Stripe from 'stripe';
import {
    Plan,
    PlanEntitlements,
    PlanFeatureFlags,
    PlanLimits,
    BillingCycle,
} from '../../database/entities/plan.entity';
import { Subscription, SubscriptionStatus } from '../../database/entities/subscription.entity';
import { User } from '../../database/entities/user.entity';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class PlansService {
    private readonly logger = new Logger(PlansService.name);
    private hasLoggedMissingPlanCodeColumn = false;
    private stripeClient: Stripe | null = null;
    private hasLoggedMissingStripeConfig = false;

    constructor(
        @InjectRepository(Plan)
        private readonly planRepository: Repository<Plan>,
        @InjectRepository(Subscription)
        private readonly subscriptionRepository: Repository<Subscription>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        private readonly redisService: RedisService,
        private readonly configService: ConfigService,
    ) {}

    // PUBLIC ENDPOINTS

    /** Get all active, visible plans for the mobile app. */
    async getPublicPlans(): Promise<Plan[]> {
        const cacheKey = 'plans:public';
        const cached = await this.redisService.getJson<Plan[]>(cacheKey);
        if (cached) return cached;

        const plans = await this.planRepository.find({
            where: { isActive: true, isVisible: true },
            order: { sortOrder: 'ASC', price: 'ASC' },
        });

        for (const plan of plans) {
            this.syncEntitlementsToLegacy(plan);
        }

        await this.redisService.setJson(cacheKey, plans, 300); // 5 min cache
        return plans;
    }

    /** Get a single plan by ID (public). */
    async getPlanById(id: string): Promise<Plan> {
        const plan = await this.planRepository.findOne({ where: { id } });
        if (!plan) throw new NotFoundException('Plan not found');
        return plan;
    }

    /** Get a plan by code (e.g. 'free', 'premium'). */
    async getPlanByCode(code: string): Promise<Plan | null> {
        return this.planRepository.findOne({ where: { code } });
    }

    /** Ensure the free plan exists in DB. Call on app startup to avoid fallback warnings. */
    async ensureFreePlanExists(): Promise<void> {
        const existing = await this.planRepository.findOne({ where: { code: 'free' } });
        if (existing) return;

        this.logger.log('Free plan not found in DB — creating default free plan');
        const freePlan = this.planRepository.create({
            code: 'free',
            name: 'Free',
            description: 'Default free plan with basic features',
            price: 0,
            currency: 'usd',
            billingCycle: BillingCycle.MONTHLY,
            stripePriceId: null,
            stripeProductId: null,
            googleProductId: null,
            googleBasePlanId: null,
            durationDays: 0,
            isActive: true,
            isVisible: false,
            sortOrder: 0,
            entitlements: {
                dailyLikes: 10,
                dailySuperLikes: 0,
                dailyCompliments: 0,
                weeklyBoosts: 0,
                monthlyRewinds: 0,
                seeWhoLikesYou: false,
                unlimitedLikes: false,
                unlimitedRewinds: false,
                advancedFilters: false,
                invisibleMode: false,
                ghostMode: false,
                passportMode: false,
                premiumBadge: false,
                hideAds: false,
                rematch: false,
                videoChat: false,
                readReceipts: false,
                typingIndicators: false,
                priorityMatching: false,
                improvedVisits: false,
                profileBoostPriority: false,
            } as PlanEntitlements,
            featureFlags: {} as PlanFeatureFlags,
            features: [] as string[],
            limits: {
                dailyLikes: 10,
                dailySuperLikes: 0,
                dailyCompliments: 0,
                weeklyBoosts: 0,
                monthlyRewinds: 0,
            } as PlanLimits,
        });
        await this.planRepository.save(freePlan);
        this.logger.log('Default free plan created successfully');
    }

    // ADMIN CRUD

    async getAllPlans(): Promise<Plan[]> {
        return this.planRepository.find({
            order: { sortOrder: 'ASC', price: 'ASC' },
        });
    }

    async createPlan(dto: Partial<Plan>): Promise<Plan> {
        // Validate unique code
        if (dto.code) {
            const existing = await this.planRepository.findOne({
                where: { code: dto.code },
            });
            if (existing) throw new BadRequestException("Plan code '" + dto.code + "' already exists");
        }

        await this.assertGooglePlayPlanMapping(dto);
        await this.ensureStripeBillingForPlan(dto);

        // Sync entitlements -> legacy columns for backward compat
        const plan = this.planRepository.create(dto);
        this.syncEntitlementsToLegacy(plan);

        const saved = await this.planRepository.save(plan);

        await this.invalidatePlansCache();
        this.logger.log(`Plan created: ${saved.code} (${saved.name})`);
        return saved;
    }

    async updatePlan(id: string, dto: Partial<Plan>): Promise<Plan> {
        const plan = await this.planRepository.findOne({ where: { id } });
        if (!plan) throw new NotFoundException('Plan not found');

        // Validate unique code if changing
        if (dto.code && dto.code !== plan.code) {
            const existing = await this.planRepository.findOne({
                where: { code: dto.code },
            });
            if (existing) throw new BadRequestException(`Plan code '${dto.code}' already exists`);
        }

        await this.assertGooglePlayPlanMapping(dto, id, plan);
        await this.ensureStripeBillingForPlan(dto, plan);

        Object.assign(plan, dto);
        this.syncEntitlementsToLegacy(plan);

        const saved = await this.planRepository.save(plan);
        await this.invalidatePlansCache();

        // Invalidate all user caches that reference this plan
        await this.invalidatePlanUserCaches(id);

        this.logger.log(`Plan updated: ${saved.code} (${saved.name})`);
        return saved;
    }

    async deletePlan(id: string): Promise<void> {
        const plan = await this.planRepository.findOne({ where: { id } });
        if (!plan) throw new NotFoundException('Plan not found');

        // Check if any active subscriptions use this plan
        const activeSubs = await this.subscriptionRepository.count({
            where: [
                { planId: id, status: SubscriptionStatus.ACTIVE },
                { planId: id, status: SubscriptionStatus.PENDING_CANCELLATION },
            ],
        });

        if (activeSubs > 0) {
            // Soft-delete: deactivate instead of hard delete
            plan.isActive = false;
            plan.isVisible = false;
            await this.planRepository.save(plan);
            await this.invalidatePlansCache();
            this.logger.warn(`Plan ${plan.code} deactivated (has ${activeSubs} active subscribers) instead of deleted`);
            return;
        }

        await this.planRepository.delete(id);
        await this.invalidatePlansCache();
        this.logger.log(`Plan deleted: ${plan.code}`);
    }

    // ENTITLEMENTS RESOLVER

    /** Resolve the effective entitlements for a user based on their active subscription. */
    async resolveUserEntitlements(userId: string): Promise<{
        plan: Plan;
        entitlements: PlanEntitlements;
        subscription: Subscription | null;
    }> {
        const cacheKey = `entitlements:${userId}`;
        const cached = await this.redisService.getJson<{
            plan: Plan;
            entitlements: PlanEntitlements;
            subscription: Subscription | null;
        }>(cacheKey);
        if (cached) return cached;

        let sub = await this.findLatestSubscriptionForEntitlements(userId);
        const now = new Date();

        // Check expiry
        if (sub && this.getSubscriptionPlanCode(sub) !== 'free' && sub.endDate && new Date(sub.endDate) < now) {
            await this.subscriptionRepository.update(sub.id, {
                status: SubscriptionStatus.EXPIRED,
            });
            await this.userRepository.update(userId, {
                isPremium: false,
                premiumStartDate: null,
                premiumExpiryDate: null,
            });
            await this.redisService.del(cacheKey);
            sub = null;
            // Fall through to free plan
        }

        let plan: Plan | null = null;

        if (sub && sub.planEntity && this.isSubscriptionCurrentlyUsable(sub, now)) {
            plan = sub.planEntity;
        }

        // Fallback to free plan
        if (!plan) {
            plan = await this.findFreePlanForEntitlements();
        }

        // Ultimate fallback: create a default free entitlements
        if (!plan) {
            this.logger.warn('No free plan found in DB, using default entitlements');
            plan = {
                id: 'default',
                code: 'free',
                name: 'Free',
                description: null,
                price: 0,
                currency: 'usd',
                billingCycle: BillingCycle.MONTHLY,
                stripePriceId: null,
                stripeProductId: null,
                googleProductId: null,
                googleBasePlanId: null,
                durationDays: 0,
                isActive: true,
                isVisible: true,
                sortOrder: 0,
                entitlements: {
                    dailyLikes: 10,
                    dailySuperLikes: 0,
                    dailyCompliments: 0,
                    monthlyRewinds: 2,
                    weeklyBoosts: 0,
                },
                featureFlags: {},
                limits: {
                    dailyLikes: 10,
                    dailySuperLikes: 0,
                    dailyCompliments: 0,
                    monthlyRewinds: 2,
                    weeklyBoosts: 0,
                },
                features: [],
                dailyLikesLimit: 10,
                dailySuperLikesLimit: 0,
                dailyComplimentsLimit: 0,
                monthlyRewindsLimit: 2,
                weeklyBoostsLimit: 0,
                subscriptions: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            } as Plan;
        }

        // Merge entitlements with legacy columns for backward compat
        const entitlements = this.mergeEntitlements(plan);

        const result = { plan, entitlements, subscription: sub };
        await this.redisService.setJson(cacheKey, result, 600); // 10 min cache
        return result;
    }

    /** Check if a user has a specific feature enabled. */
    async hasFeature(userId: string, feature: keyof PlanEntitlements): Promise<boolean> {
        const { entitlements } = await this.resolveUserEntitlements(userId);
        const value = entitlements[feature];
        return value === true || value === -1 || (typeof value === 'number' && value > 0);
    }

    /** Get a numeric limit for a user. Returns -1 for unlimited. */
    async getLimit(userId: string, limit: keyof PlanEntitlements): Promise<number> {
        const { entitlements } = await this.resolveUserEntitlements(userId);
        const value = entitlements[limit];
        if (value === undefined || value === null) return 0;
        return typeof value === 'number' ? value : 0;
    }

    // HELPERS

    /** Merge entitlements JSONB with legacy columns (legacy takes precedence if set). */
    private mergeEntitlements(plan: Plan): PlanEntitlements {
        const ent: PlanEntitlements = {
            ...(plan.entitlements || {}),
            ...this.pickNumericLimits(plan.limits),
            ...this.pickBooleanFeatures(plan.featureFlags),
        };

        if (ent.dailyLikes === undefined && ent.likesLimit !== undefined) {
            ent.dailyLikes = ent.likesLimit;
        }
        if (ent.likesLimit === undefined && ent.dailyLikes !== undefined) {
            ent.likesLimit = ent.dailyLikes;
        }

        if (ent.weeklyBoosts === undefined && ent.boostsLimit !== undefined) {
            ent.weeklyBoosts = ent.boostsLimit;
        }
        if (ent.boostsLimit === undefined && ent.weeklyBoosts !== undefined) {
            ent.boostsLimit = ent.weeklyBoosts;
        }

        if (ent.dailyCompliments === undefined && ent.complimentsLimit !== undefined) {
            ent.dailyCompliments = ent.complimentsLimit;
        }
        if (ent.complimentsLimit === undefined && ent.dailyCompliments !== undefined) {
            ent.complimentsLimit = ent.dailyCompliments;
        }

        if (ent.seeWhoLikesYou === undefined && ent.whoLikedMe !== undefined) {
            ent.seeWhoLikesYou = ent.whoLikedMe;
        }
        if (ent.whoLikedMe === undefined && ent.seeWhoLikesYou !== undefined) {
            ent.whoLikedMe = ent.seeWhoLikesYou;
        }

        if (ent.invisibleMode === undefined && ent.ghostMode !== undefined) {
            ent.invisibleMode = ent.ghostMode;
        }
        if (ent.ghostMode === undefined && ent.invisibleMode !== undefined) {
            ent.ghostMode = ent.invisibleMode;
        }

        // Sync from legacy columns if they differ from entitlements
        if (plan.dailyLikesLimit !== undefined && ent.dailyLikes === undefined) {
            ent.dailyLikes = plan.dailyLikesLimit;
        }
        if (plan.dailySuperLikesLimit !== undefined && ent.dailySuperLikes === undefined) {
            ent.dailySuperLikes = plan.dailySuperLikesLimit;
        }
        if (plan.dailyComplimentsLimit !== undefined && ent.dailyCompliments === undefined) {
            ent.dailyCompliments = plan.dailyComplimentsLimit;
        }
        if (plan.monthlyRewindsLimit !== undefined && ent.monthlyRewinds === undefined) {
            ent.monthlyRewinds = plan.monthlyRewindsLimit;
        }
        if (plan.weeklyBoostsLimit !== undefined && ent.weeklyBoosts === undefined) {
            ent.weeklyBoosts = plan.weeklyBoostsLimit;
        }

        // Derive unlimitedLikes from dailyLikes = -1
        if (ent.dailyLikes === -1) ent.unlimitedLikes = true;
        if (ent.monthlyRewinds === -1) ent.unlimitedRewinds = true;
        if (ent.boost === undefined) {
            ent.boost =
                ent.profileBoostPriority === true || (typeof ent.weeklyBoosts === 'number' && ent.weeklyBoosts !== 0);
        }
        if (ent.likes === undefined) {
            ent.likes = ent.unlimitedLikes === true || (typeof ent.dailyLikes === 'number' && ent.dailyLikes !== 0);
        }

        return ent;
    }

    /** Sync entitlements JSONB -> legacy columns for backward compatibility. */
    private syncEntitlementsToLegacy(plan: Plan): void {
        const ent: PlanEntitlements = {
            ...(plan.entitlements || {}),
            ...this.pickNumericLimits(plan.limits),
            ...this.pickBooleanFeatures(plan.featureFlags),
        };

        plan.entitlements = ent;

        if (ent.dailyLikes === undefined && ent.likesLimit !== undefined) {
            ent.dailyLikes = ent.likesLimit;
        }
        if (ent.likesLimit === undefined && ent.dailyLikes !== undefined) {
            ent.likesLimit = ent.dailyLikes;
        }

        if (ent.weeklyBoosts === undefined && ent.boostsLimit !== undefined) {
            ent.weeklyBoosts = ent.boostsLimit;
        }
        if (ent.boostsLimit === undefined && ent.weeklyBoosts !== undefined) {
            ent.boostsLimit = ent.weeklyBoosts;
        }

        if (ent.dailyCompliments === undefined && ent.complimentsLimit !== undefined) {
            ent.dailyCompliments = ent.complimentsLimit;
        }
        if (ent.complimentsLimit === undefined && ent.dailyCompliments !== undefined) {
            ent.complimentsLimit = ent.dailyCompliments;
        }

        if (ent.seeWhoLikesYou === undefined && ent.whoLikedMe !== undefined) {
            ent.seeWhoLikesYou = ent.whoLikedMe;
        }
        if (ent.whoLikedMe === undefined && ent.seeWhoLikesYou !== undefined) {
            ent.whoLikedMe = ent.seeWhoLikesYou;
        }

        if (ent.invisibleMode === undefined && ent.ghostMode !== undefined) {
            ent.invisibleMode = ent.ghostMode;
        }
        if (ent.ghostMode === undefined && ent.invisibleMode !== undefined) {
            ent.ghostMode = ent.invisibleMode;
        }

        if (ent.dailyLikes !== undefined) plan.dailyLikesLimit = ent.dailyLikes;
        if (ent.dailySuperLikes !== undefined) plan.dailySuperLikesLimit = ent.dailySuperLikes;
        if (ent.dailyCompliments !== undefined) plan.dailyComplimentsLimit = ent.dailyCompliments;
        if (ent.monthlyRewinds !== undefined) plan.monthlyRewindsLimit = ent.monthlyRewinds;
        if (ent.weeklyBoosts !== undefined) plan.weeklyBoostsLimit = ent.weeklyBoosts;

        // Derive features array from entitlements boolean flags
        const featureFlags: string[] = [];
        if (ent.unlimitedLikes || ent.dailyLikes === -1) featureFlags.push('unlimited_likes');
        if (ent.advancedFilters) featureFlags.push('advanced_filters');
        if (ent.seeWhoLikesYou) featureFlags.push('see_who_liked');
        if (ent.whoLikedMe) featureFlags.push('who_liked_me');
        if (ent.superLike || ent.dailySuperLikes === -1 || (ent.dailySuperLikes ?? 0) > 0)
            featureFlags.push('super_like');
        if (ent.profileBoostPriority || ent.weeklyBoosts === -1 || (ent.weeklyBoosts ?? 0) > 0)
            featureFlags.push('profile_boost');
        if (ent.boost) featureFlags.push('boost');
        if (ent.readReceipts) featureFlags.push('read_receipts');
        if (ent.priorityMatching) featureFlags.push('priority_matching');
        if (ent.unlimitedRewinds || ent.monthlyRewinds === -1) featureFlags.push('rewind');
        if (ent.invisibleMode) featureFlags.push('invisible_mode');
        if (ent.ghostMode) featureFlags.push('ghost_mode');
        if (ent.dailyCompliments === -1 || (ent.dailyCompliments ?? 0) > 0) featureFlags.push('compliment_credits');
        if (ent.rematch) featureFlags.push('rematch');
        if (ent.premiumBadge) featureFlags.push('premium_badge');
        if (ent.hideAds) featureFlags.push('hide_ads');
        if (ent.passportMode) featureFlags.push('passport_mode');
        if (ent.improvedVisits) featureFlags.push('improved_visits');
        if (ent.videoChat) featureFlags.push('video_chat');
        if (ent.typingIndicators) featureFlags.push('typing_indicators');
        plan.features = featureFlags;
        plan.featureFlags = this.extractFeatureFlags(ent);
        plan.limits = this.extractLimits(ent);
    }

    private async assertGooglePlayPlanMapping(
        dto: Partial<Plan>,
        currentPlanId?: string,
        currentPlan?: Plan,
    ): Promise<void> {
        const effectivePrice = dto.price !== undefined ? Number(dto.price) : Number(currentPlan?.price ?? 0);
        const isPaidPlan = Number.isFinite(effectivePrice) && effectivePrice > 0;
        if (!isPaidPlan) {
            return;
        }

        const googleProductId =
            this.normalizeNullableString(dto.googleProductId) || currentPlan?.googleProductId || null;
        if (!googleProductId) {
            throw new BadRequestException('googleProductId is required for paid plans');
        }

        const googleBasePlanId =
            this.normalizeNullableString(dto.googleBasePlanId) || currentPlan?.googleBasePlanId || null;
        if (!googleBasePlanId) {
            throw new BadRequestException('googleBasePlanId is required for paid plans');
        }

        const compositeCollision = await this.planRepository.findOne({
            where: {
                googleProductId,
                googleBasePlanId,
            },
        });
        if (compositeCollision && compositeCollision.id !== currentPlanId) {
            throw new BadRequestException(
                `googleProductId '${googleProductId}' + googleBasePlanId '${googleBasePlanId}' is already mapped to another plan`,
            );
        }

        dto.googleProductId = googleProductId;
        dto.googleBasePlanId = googleBasePlanId;
    }

    private async ensureStripeBillingForPlan(
        dto: Partial<Plan>,
        currentPlan?: Plan,
    ): Promise<void> {
        const nextPlan = this.buildStripePlanSnapshot(dto, currentPlan);
        const isPaidPlan = nextPlan.price > 0;

        if (!isPaidPlan) {
            dto.stripePriceId = null;
            dto.stripeProductId = null;
            return;
        }

        const stripe = this.getStripeClient();
        const existingStripeProductId =
            this.normalizeNullableString(dto.stripeProductId) ||
            currentPlan?.stripeProductId ||
            null;
        const existingStripePriceId =
            this.normalizeNullableString(dto.stripePriceId) ||
            currentPlan?.stripePriceId ||
            null;

        if (!stripe) {
            if (existingStripeProductId && existingStripePriceId) {
                dto.stripeProductId = existingStripeProductId;
                dto.stripePriceId = existingStripePriceId;
                return;
            }

            throw new BadRequestException(
                'Stripe is not configured on this server, so paid plans cannot auto-generate Stripe billing yet.',
            );
        }

        const stripeProductId = await this.ensureStripeProduct(nextPlan, existingStripeProductId);
        const priceNeedsRefresh = this.shouldCreateFreshStripePrice(
            nextPlan,
            currentPlan,
            existingStripePriceId,
            stripeProductId,
        );

        let stripePriceId = existingStripePriceId;
        if (priceNeedsRefresh) {
            stripePriceId = await this.createStripePrice(nextPlan, stripeProductId);
            try {
                await stripe.products.update(stripeProductId, {
                    default_price: stripePriceId,
                });
            } catch (error) {
                this.logger.warn(
                    `Failed to set default Stripe price for plan ${nextPlan.code}: ${(error as Error).message}`,
                );
            }
        }

        dto.stripeProductId = stripeProductId;
        dto.stripePriceId = stripePriceId;
    }

    private buildStripePlanSnapshot(
        dto: Partial<Plan>,
        currentPlan?: Plan,
    ): {
        code: string;
        name: string;
        description: string | null;
        price: number;
        currency: string;
        billingCycle: BillingCycle;
        durationDays: number;
        isActive: boolean;
    } {
        const description =
            dto.description !== undefined
                ? this.normalizeNullableString(dto.description)
                : currentPlan?.description ?? null;

        const billingCycle =
            dto.billingCycle || currentPlan?.billingCycle || BillingCycle.MONTHLY;
        const rawPrice = dto.price !== undefined ? Number(dto.price) : Number(currentPlan?.price ?? 0);
        const price = Number.isFinite(rawPrice) ? rawPrice : 0;
        const rawDurationDays =
            dto.durationDays !== undefined
                ? Number(dto.durationDays)
                : Number(currentPlan?.durationDays ?? 30);
        const durationDays = Number.isFinite(rawDurationDays) && rawDurationDays > 0
            ? Math.trunc(rawDurationDays)
            : 30;

        return {
            code: (dto.code || currentPlan?.code || '').trim(),
            name: (dto.name || currentPlan?.name || '').trim(),
            description,
            price,
            currency: (dto.currency || currentPlan?.currency || 'usd').trim().toLowerCase(),
            billingCycle,
            durationDays,
            isActive: dto.isActive !== undefined ? Boolean(dto.isActive) : (currentPlan?.isActive ?? true),
        };
    }

    private getStripeClient(): Stripe | null {
        if (this.stripeClient) {
            return this.stripeClient;
        }

        const secretKey =
            this.configService.get<string>('stripe.secretKey') ||
            this.configService.get<string>('STRIPE_SECRET_KEY') ||
            '';

        if (!secretKey) {
            if (!this.hasLoggedMissingStripeConfig) {
                this.logger.warn(
                    'STRIPE_SECRET_KEY not set. Paid plan authoring cannot auto-generate Stripe products/prices.',
                );
                this.hasLoggedMissingStripeConfig = true;
            }
            return null;
        }

        this.stripeClient = new Stripe(secretKey, {
            apiVersion: '2024-06-20' as any,
        });
        return this.stripeClient;
    }

    private async ensureStripeProduct(
        plan: {
            code: string;
            name: string;
            description: string | null;
            price: number;
            currency: string;
            billingCycle: BillingCycle;
            durationDays: number;
            isActive: boolean;
        },
        existingProductId: string | null,
    ): Promise<string> {
        const stripe = this.getStripeClient();
        if (!stripe) {
            throw new BadRequestException('Stripe is not configured on this server.');
        }

        const metadata = this.buildStripePlanMetadata(plan);

        if (existingProductId) {
            try {
                const updated = await stripe.products.update(existingProductId, {
                    name: plan.name,
                    description: plan.description || undefined,
                    active: plan.isActive,
                    metadata,
                });
                return updated.id;
            } catch (error) {
                this.logger.warn(
                    `Failed to update Stripe product ${existingProductId} for plan ${plan.code}. Creating a new product instead. Error: ${(error as Error).message}`,
                );
            }
        }

        const created = await stripe.products.create({
            name: plan.name,
            description: plan.description || undefined,
            active: plan.isActive,
            metadata,
        });
        return created.id;
    }

    private async createStripePrice(
        plan: {
            code: string;
            name: string;
            description: string | null;
            price: number;
            currency: string;
            billingCycle: BillingCycle;
            durationDays: number;
            isActive: boolean;
        },
        stripeProductId: string,
    ): Promise<string> {
        const stripe = this.getStripeClient();
        if (!stripe) {
            throw new BadRequestException('Stripe is not configured on this server.');
        }

        const unitAmount = this.toStripeUnitAmount(plan.price);
        const params: Stripe.PriceCreateParams = {
            product: stripeProductId,
            unit_amount: unitAmount,
            currency: plan.currency,
            nickname: `${plan.name} (${plan.billingCycle})`,
            metadata: this.buildStripePlanMetadata(plan),
        };

        if (plan.billingCycle !== BillingCycle.ONE_TIME) {
            params.recurring = {
                interval: this.mapBillingCycleToStripeInterval(plan.billingCycle),
            };
        }

        const created = await stripe.prices.create(params);
        return created.id;
    }

    private shouldCreateFreshStripePrice(
        nextPlan: {
            code: string;
            name: string;
            description: string | null;
            price: number;
            currency: string;
            billingCycle: BillingCycle;
            durationDays: number;
            isActive: boolean;
        },
        currentPlan: Plan | undefined,
        existingStripePriceId: string | null,
        stripeProductId: string,
    ): boolean {
        if (!existingStripePriceId || !currentPlan) {
            return true;
        }

        const currentPrice = Number(currentPlan.price ?? 0);
        const currentCurrency = (currentPlan.currency || 'usd').trim().toLowerCase();

        return (
            stripeProductId !== (currentPlan.stripeProductId || null) ||
            nextPlan.billingCycle !== currentPlan.billingCycle ||
            nextPlan.currency !== currentCurrency ||
            Math.abs(nextPlan.price - currentPrice) > 0.000001
        );
    }

    private buildStripePlanMetadata(plan: {
        code: string;
        name: string;
        description: string | null;
        price: number;
        currency: string;
        billingCycle: BillingCycle;
        durationDays: number;
        isActive: boolean;
    }): Record<string, string> {
        return {
            internalPlanCode: plan.code,
            internalPlanName: plan.name,
            billingCycle: plan.billingCycle,
            durationDays: String(plan.durationDays),
        };
    }

    private mapBillingCycleToStripeInterval(
        billingCycle: BillingCycle,
    ): Stripe.PriceCreateParams.Recurring.Interval {
        switch (billingCycle) {
            case BillingCycle.YEARLY:
                return 'year';
            case BillingCycle.WEEKLY:
                return 'week';
            case BillingCycle.MONTHLY:
            default:
                return 'month';
        }
    }

    private toStripeUnitAmount(price: number): number {
        const normalized = Number(price);
        if (!Number.isFinite(normalized) || normalized <= 0) {
            throw new BadRequestException('Paid plans must have a Stripe-compatible price greater than 0.');
        }

        return Math.round(normalized * 100);
    }

    private normalizeNullableString(value?: string | null): string | null {
        if (!value) return null;
        const normalized = String(value).trim();
        return normalized.length > 0 ? normalized : null;
    }

    private pickNumericLimits(limits?: PlanLimits | null): Partial<PlanEntitlements> {
        if (!limits || typeof limits !== 'object') {
            return {};
        }

        const result: Partial<PlanEntitlements> = {};
        const keys: Array<keyof PlanLimits> = [
            'dailyLikes',
            'dailySuperLikes',
            'dailyCompliments',
            'monthlyRewinds',
            'weeklyBoosts',
            'likesLimit',
            'boostsLimit',
            'complimentsLimit',
        ];

        for (const key of keys) {
            const value = limits[key];
            if (typeof value === 'number' && Number.isFinite(value)) {
                (result as any)[key] = value;
            }
        }

        return result;
    }

    private pickBooleanFeatures(featureFlags?: PlanFeatureFlags | null): Partial<PlanEntitlements> {
        if (!featureFlags || typeof featureFlags !== 'object') {
            return {};
        }

        const result: Partial<PlanEntitlements> = {};
        const keys: Array<keyof PlanFeatureFlags> = [
            'unlimitedLikes',
            'unlimitedRewinds',
            'advancedFilters',
            'seeWhoLikesYou',
            'readReceipts',
            'typingIndicators',
            'invisibleMode',
            'ghostMode',
            'passportMode',
            'whoLikedMe',
            'boost',
            'likes',
            'premiumBadge',
            'hideAds',
            'rematch',
            'videoChat',
            'superLike',
            'profileBoostPriority',
            'priorityMatching',
            'improvedVisits',
        ];

        for (const key of keys) {
            const value = featureFlags[key];
            if (typeof value === 'boolean') {
                (result as any)[key] = value;
            }
        }

        return result;
    }

    private extractFeatureFlags(entitlements: PlanEntitlements): PlanFeatureFlags {
        return {
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

    private extractLimits(entitlements: PlanEntitlements): PlanLimits {
        return {
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

    private async invalidatePlansCache(): Promise<void> {
        await this.redisService.del('plans:public');
    }

    private async invalidatePlanUserCaches(planId: string): Promise<void> {
        const subs = await this.subscriptionRepository.find({
            where: [
                { planId, status: SubscriptionStatus.ACTIVE },
                { planId, status: SubscriptionStatus.PENDING_CANCELLATION },
            ],
            select: ['userId'],
        });
        if (subs.length === 0) return;

        await Promise.all(
            subs.flatMap((s) => [
                this.redisService.del(`entitlements:${s.userId}`),
                this.redisService.del(`plan:${s.userId}`),
                this.redisService.del(`features:${s.userId}`),
                this.redisService.del(`premium:${s.userId}`),
            ]),
        );
    }

    private async findLatestSubscriptionForEntitlements(userId: string): Promise<Subscription | null> {
        let subscriptions: Subscription[];
        try {
            subscriptions = await this.subscriptionRepository.find({
                where: [
                    { userId, status: SubscriptionStatus.ACTIVE },
                    { userId, status: SubscriptionStatus.PENDING_CANCELLATION },
                    { userId, status: SubscriptionStatus.PAST_DUE },
                    { userId, status: SubscriptionStatus.TRIAL },
                ],
                order: { createdAt: 'DESC' },
                relations: ['planEntity'],
            });
        } catch (error) {
            if (!this.isMissingPlanCodeColumnError(error)) {
                throw error;
            }

            this.logMissingPlanCodeColumnWarning('resolveUserEntitlements:subscription');
            subscriptions = await this.subscriptionRepository.find({
                where: [
                    { userId, status: SubscriptionStatus.ACTIVE },
                    { userId, status: SubscriptionStatus.PENDING_CANCELLATION },
                    { userId, status: SubscriptionStatus.PAST_DUE },
                    { userId, status: SubscriptionStatus.TRIAL },
                ],
                order: { createdAt: 'DESC' },
            });
        }

        return this.selectCurrentSubscriptionForEntitlements(subscriptions);
    }

    private selectCurrentSubscriptionForEntitlements(subscriptions: Subscription[]): Subscription | null {
        if (subscriptions.length === 0) {
            return null;
        }

        const now = new Date();
        return [...subscriptions].sort((a, b) => this.compareSubscriptionsForCurrentPlan(a, b, now))[0];
    }

    private compareSubscriptionsForCurrentPlan(a: Subscription, b: Subscription, now: Date): number {
        const rankDifference = this.subscriptionCurrentPlanRank(b, now) - this.subscriptionCurrentPlanRank(a, now);
        if (rankDifference !== 0) {
            return rankDifference;
        }

        const endDateDifference = this.subscriptionEndDateSortValue(b) - this.subscriptionEndDateSortValue(a);
        if (endDateDifference !== 0) {
            return endDateDifference;
        }

        return this.dateSortValue(b.createdAt) - this.dateSortValue(a.createdAt);
    }

    private subscriptionCurrentPlanRank(subscription: Subscription, now: Date): number {
        const planCode = this.getSubscriptionPlanCode(subscription);
        if (planCode === 'free') {
            return 1;
        }

        if (!this.hasActiveEntitlementStatus(subscription.status)) {
            return 0;
        }

        const startDate = subscription.startDate ? new Date(subscription.startDate) : null;
        const endDate = subscription.endDate ? new Date(subscription.endDate) : null;

        if (endDate && endDate < now) {
            return 3;
        }

        if (startDate && startDate > now) {
            return 2;
        }

        return 4;
    }

    private isSubscriptionCurrentlyUsable(subscription: Subscription, now: Date): boolean {
        if (!this.hasActiveEntitlementStatus(subscription.status)) {
            return false;
        }

        const startDate = subscription.startDate ? new Date(subscription.startDate) : null;
        if (startDate && startDate > now) {
            return false;
        }

        const endDate = subscription.endDate ? new Date(subscription.endDate) : null;
        return !endDate || endDate >= now;
    }

    private hasActiveEntitlementStatus(status?: SubscriptionStatus | null): boolean {
        return (
            status === SubscriptionStatus.ACTIVE ||
            status === SubscriptionStatus.PENDING_CANCELLATION ||
            status === SubscriptionStatus.PAST_DUE ||
            status === SubscriptionStatus.TRIAL
        );
    }

    private getSubscriptionPlanCode(subscription?: Partial<Subscription> | null): string {
        return this.normalizePlanToken(subscription?.planEntity?.code ?? subscription?.plan) || 'free';
    }

    private subscriptionEndDateSortValue(subscription: Subscription): number {
        return subscription.endDate ? new Date(subscription.endDate).getTime() : Number.MAX_SAFE_INTEGER;
    }

    private dateSortValue(value?: Date | string | null): number {
        return value ? new Date(value).getTime() : 0;
    }

    private normalizePlanToken(value?: string | null): string {
        return (value ?? '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
    }

    private async findFreePlanForEntitlements(): Promise<Plan | null> {
        try {
            return await this.planRepository.findOne({
                where: { code: 'free', isActive: true },
            });
        } catch (error) {
            if (!this.isMissingPlanCodeColumnError(error)) {
                throw error;
            }

            this.logMissingPlanCodeColumnWarning('resolveUserEntitlements:free-plan');
            return null;
        }
    }

    private logMissingPlanCodeColumnWarning(context: string): void {
        if (this.hasLoggedMissingPlanCodeColumn) {
            return;
        }

        this.hasLoggedMissingPlanCodeColumn = true;
        this.logger.warn(
            `plans.code column is missing in the database. Falling back to legacy subscription plan behavior in ${context}. Run migrations to restore dynamic plan support.`,
        );
    }

    private isMissingPlanCodeColumnError(error: unknown): boolean {
        if (!error || typeof error !== 'object') {
            return false;
        }

        const message = String((error as { message?: unknown }).message ?? '');
        if (!message.toLowerCase().includes('does not exist')) {
            return false;
        }

        return (
            message.includes('planEntity.code') ||
            message.includes('Subscription__Subscription_planEntity.code') ||
            message.includes('column "code" of relation "plans" does not exist')
        );
    }
}

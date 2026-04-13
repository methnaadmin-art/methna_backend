import {
    Injectable,
    NotFoundException,
    BadRequestException,
    Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Stripe from 'stripe';
import {
    Plan,
    PlanEntitlements,
    BillingCycle,
} from '../../database/entities/plan.entity';
import {
    Subscription,
    SubscriptionStatus,
} from '../../database/entities/subscription.entity';
import { User } from '../../database/entities/user.entity';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class PlansService {
    private readonly logger = new Logger(PlansService.name);
    private hasLoggedMissingPlanCodeColumn = false;
    private stripe: Stripe | null = null;

    constructor(
        @InjectRepository(Plan)
        private readonly planRepository: Repository<Plan>,
        @InjectRepository(Subscription)
        private readonly subscriptionRepository: Repository<Subscription>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        private readonly configService: ConfigService,
        private readonly redisService: RedisService,
    ) {
        const stripeKey = this.normalizeConfigValue(
            this.configService.get<string>('STRIPE_SECRET_KEY') ||
            this.configService.get<string>('stripe.secretKey'),
        );

        if (stripeKey) {
            this.stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' as any });
        } else {
            this.logger.warn('STRIPE_SECRET_KEY is missing. Auto Stripe price creation for plans is disabled.');
        }
    }

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

    // ADMIN CRUD

    async getAllPlans(): Promise<Plan[]> {
        return this.planRepository.find({ order: { sortOrder: 'ASC', price: 'ASC' } });
    }

    async createPlan(dto: Partial<Plan>): Promise<Plan> {
        // Validate unique code
        if (dto.code) {
            const existing = await this.planRepository.findOne({ where: { code: dto.code } });
            if (existing) throw new BadRequestException("Plan code '" + dto.code + "' already exists");
        }

        // Sync entitlements -> legacy columns for backward compat
        const plan = this.planRepository.create(dto);
        this.syncEntitlementsToLegacy(plan);

        const saved = await this.planRepository.manager.transaction(async manager => {
            const planRepo = manager.getRepository(Plan);

            let created = await planRepo.save(plan);
            await this.ensureStripePriceForPaidPlan(created, { forceRegenerate: false });
            created = await planRepo.save(created);

            return created;
        });

        await this.invalidatePlansCache();
        this.logger.log(`Plan created: ${saved.code} (${saved.name})`);
        return saved;
    }

    async updatePlan(id: string, dto: Partial<Plan>): Promise<Plan> {
        const plan = await this.planRepository.findOne({ where: { id } });
        if (!plan) throw new NotFoundException('Plan not found');

        // Validate unique code if changing
        if (dto.code && dto.code !== plan.code) {
            const existing = await this.planRepository.findOne({ where: { code: dto.code } });
            if (existing) throw new BadRequestException(`Plan code '${dto.code}' already exists`);
        }

        const pricingChanged =
            dto.price !== undefined ||
            dto.currency !== undefined ||
            dto.billingCycle !== undefined;
        const stripePriceIdTouched = Object.prototype.hasOwnProperty.call(dto, 'stripePriceId');
        const stripePriceExplicitlyProvided = stripePriceIdTouched && !!dto.stripePriceId;

        Object.assign(plan, dto);
        this.syncEntitlementsToLegacy(plan);

        await this.ensureStripePriceForPaidPlan(plan, {
            forceRegenerate: !stripePriceExplicitlyProvided && (pricingChanged || !plan.stripePriceId),
        });

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
            where: { planId: id, status: SubscriptionStatus.ACTIVE },
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

        const sub = await this.findLatestSubscriptionForEntitlements(userId);

        // Check expiry
        if (sub && sub.endDate && new Date(sub.endDate) < new Date()) {
            await this.subscriptionRepository.update(sub.id, { status: SubscriptionStatus.EXPIRED });
            await this.userRepository.update(userId, {
                isPremium: false,
                premiumStartDate: null,
                premiumExpiryDate: null,
            });
            await this.redisService.del(cacheKey);
            // Fall through to free plan
        }

        let plan: Plan | null = null;

        if (sub && sub.planEntity && (!sub.endDate || new Date(sub.endDate) >= new Date())) {
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
                googleProductId: null,
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
        const ent: PlanEntitlements = { ...plan.entitlements };

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

        return ent;
    }

    /** Sync entitlements JSONB -> legacy columns for backward compatibility. */
    private syncEntitlementsToLegacy(plan: Plan): void {
        const ent = plan.entitlements || {};
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
        if (ent.superLike || ent.dailySuperLikes === -1 || (ent.dailySuperLikes ?? 0) > 0) featureFlags.push('super_like');
        if (ent.profileBoostPriority || ent.weeklyBoosts === -1 || (ent.weeklyBoosts ?? 0) > 0) featureFlags.push('profile_boost');
        if (ent.readReceipts) featureFlags.push('read_receipts');
        if (ent.priorityMatching) featureFlags.push('priority_matching');
        if (ent.unlimitedRewinds || ent.monthlyRewinds === -1) featureFlags.push('rewind');
        if (ent.invisibleMode) featureFlags.push('invisible_mode');
        if (ent.dailyCompliments === -1 || (ent.dailyCompliments ?? 0) > 0) featureFlags.push('compliment_credits');
        if (ent.rematch) featureFlags.push('rematch');
        if (ent.premiumBadge) featureFlags.push('premium_badge');
        if (ent.hideAds) featureFlags.push('hide_ads');
        if (ent.passportMode) featureFlags.push('passport_mode');
        if (ent.improvedVisits) featureFlags.push('improved_visits');
        if (ent.videoChat) featureFlags.push('video_chat');
        if (ent.typingIndicators) featureFlags.push('typing_indicators');
        plan.features = featureFlags;
    }

    private async ensureStripePriceForPaidPlan(
        plan: Plan,
        options: { forceRegenerate: boolean },
    ): Promise<void> {
        const numericPrice = Number(plan.price ?? 0);
        if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
            return;
        }

        if (plan.stripePriceId && !options.forceRegenerate) {
            return;
        }

        if (!this.stripe) {
            throw new BadRequestException(
                'Stripe is not configured on the server. Set STRIPE_SECRET_KEY or provide Stripe Price ID manually.',
            );
        }

        plan.stripePriceId = await this.createStripePriceForPlan(plan, numericPrice);
    }

    private async createStripePriceForPlan(plan: Plan, numericPrice: number): Promise<string> {
        if (!this.stripe) {
            throw new BadRequestException('Stripe client is not initialized');
        }

        const currency = String(plan.currency || 'usd').toLowerCase();
        const unitAmount = Math.round(numericPrice * 100);
        if (unitAmount <= 0) {
            throw new BadRequestException('Plan price must be greater than zero for Stripe pricing');
        }

        const interval = this.mapBillingCycleToStripeInterval(plan.billingCycle);

        try {
            const product = await this.stripe.products.create({
                name: plan.name,
                description: plan.description || undefined,
                metadata: {
                    planId: plan.id,
                    planCode: plan.code,
                },
            });

            const priceParams: Stripe.PriceCreateParams = {
                currency,
                unit_amount: unitAmount,
                product: product.id,
                metadata: {
                    planId: plan.id,
                    planCode: plan.code,
                },
            };

            if (interval) {
                priceParams.recurring = { interval };
            }

            const stripePrice = await this.stripe.prices.create(priceParams);
            this.logger.log(`Auto-created Stripe price ${stripePrice.id} for plan ${plan.code}`);
            return stripePrice.id;
        } catch (error) {
            this.logger.error(
                `Failed auto-creating Stripe price for plan ${plan.code}: ${(error as Error).message}`,
            );
            throw new BadRequestException(
                `Unable to auto-create Stripe price for plan '${plan.code}'. Verify Stripe keys and try again.`,
            );
        }
    }

    private mapBillingCycleToStripeInterval(
        cycle?: BillingCycle,
    ): Stripe.PriceCreateParams.Recurring.Interval | null {
        switch (cycle) {
            case BillingCycle.WEEKLY:
                return 'week';
            case BillingCycle.YEARLY:
                return 'year';
            case BillingCycle.ONE_TIME:
                return null;
            case BillingCycle.MONTHLY:
            default:
                return 'month';
        }
    }

    private normalizeConfigValue(value?: string | null): string | null {
        if (!value) return null;
        const trimmed = value.trim();
        if (!trimmed) return null;
        const withoutSingleQuotes =
            trimmed.startsWith("'") && trimmed.endsWith("'")
                ? trimmed.slice(1, -1)
                : trimmed;
        const withoutDoubleQuotes =
            withoutSingleQuotes.startsWith('"') && withoutSingleQuotes.endsWith('"')
                ? withoutSingleQuotes.slice(1, -1)
                : withoutSingleQuotes;
        return withoutDoubleQuotes.trim() || null;
    }

    private async invalidatePlansCache(): Promise<void> {
        await this.redisService.del('plans:public');
    }

    private async invalidatePlanUserCaches(planId: string): Promise<void> {
        const subs = await this.subscriptionRepository.find({
            where: { planId, status: SubscriptionStatus.ACTIVE },
            select: ['userId'],
        });
        if (subs.length === 0) return;

        await Promise.all(
            subs.flatMap(s => [
                this.redisService.del(`entitlements:${s.userId}`),
                this.redisService.del(`plan:${s.userId}`),
                this.redisService.del(`features:${s.userId}`),
                this.redisService.del(`premium:${s.userId}`),
            ]),
        );
    }

    private async findLatestSubscriptionForEntitlements(userId: string): Promise<Subscription | null> {
        try {
            return await this.subscriptionRepository.findOne({
                where: [
                    { userId, status: SubscriptionStatus.ACTIVE },
                    { userId, status: SubscriptionStatus.PAST_DUE },
                ],
                order: { createdAt: 'DESC' },
                relations: ['planEntity'],
            });
        } catch (error) {
            if (!this.isMissingPlanCodeColumnError(error)) {
                throw error;
            }

            this.logMissingPlanCodeColumnWarning('resolveUserEntitlements:subscription');
            return this.subscriptionRepository.findOne({
                where: [
                    { userId, status: SubscriptionStatus.ACTIVE },
                    { userId, status: SubscriptionStatus.PAST_DUE },
                ],
                order: { createdAt: 'DESC' },
            });
        }
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

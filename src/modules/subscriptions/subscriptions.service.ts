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
    SubscriptionStatus,
} from '../../database/entities/subscription.entity';
import { User } from '../../database/entities/user.entity';
import { RedisService } from '../redis/redis.service';
import { Plan } from '../../database/entities/plan.entity';

@Injectable()
export class SubscriptionsService {
    private readonly logger = new Logger(SubscriptionsService.name);
    private hasLoggedMissingPremiumColumns = false;
    private hasLoggedMissingPlanCodeColumn = false;

    constructor(
        @InjectRepository(Subscription)
        private readonly subscriptionRepository: Repository<Subscription>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(Plan)
        private readonly planRepository: Repository<Plan>,
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
        const planEntity = await this.planRepository.findOne({
            where: { code: 'trial', isActive: true },
        });

        const subscription = this.subscriptionRepository.create({
            userId,
            plan: 'trial',
            planId: planEntity?.id ?? null,
            planEntity: planEntity ?? null,
            status: SubscriptionStatus.TRIAL,
            startDate: now,
            endDate,
            paymentProvider: 'trial',
        });

        const saved = await this.subscriptionRepository.save(subscription);
        await this.updateUserPremiumState(
            userId,
            true,
            now,
            endDate,
            planEntity?.id ?? null,
        );
        await this.invalidatePremiumCaches(userId);
        
        return saved;
    }

    async getMySubscription(userId: string): Promise<Subscription> {
        let sub: Subscription | null;
        try {
            sub = await this.subscriptionRepository.findOne({
                where: { userId },
                order: { createdAt: 'DESC' },
                relations: ['planEntity'],
            });
        } catch (error) {
            if (!this.isMissingPlanCodeColumnError(error)) {
                throw error;
            }

            this.logMissingPlanCodeColumnWarning('getMySubscription');
            sub = await this.subscriptionRepository.findOne({
                where: { userId },
                order: { createdAt: 'DESC' },
            });
        }

        if (!sub) {
            const freePlan = await this.planRepository.findOne({
                where: { code: 'free', isActive: true },
            });
            // Create default free subscription
            sub = this.subscriptionRepository.create({
                userId,
                plan: freePlan?.code ?? 'free',
                planId: freePlan?.id ?? null,
                planEntity: freePlan ?? null,
                status: SubscriptionStatus.ACTIVE,
            });
            await this.subscriptionRepository.save(sub);
        }

        return sub;
    }

    async createSubscription(
        userId: string,
        planRef: string,
        durationDays?: number,
        paymentReference?: string,
    ): Promise<Subscription> {
        const normalizedPlanRef = (planRef || '').trim();
        if (!normalizedPlanRef) throw new BadRequestException('planId or planCode is required');

        const planEntity = await this.planRepository.findOne({
            where: this.planLookupWhere(normalizedPlanRef, { isActive: true, isVisible: true }),
        });
        if (!planEntity) throw new BadRequestException('Plan not found, inactive, or hidden');

        if (Number(planEntity.price) > 0) {
            throw new BadRequestException('Paid plans must be activated through Google Play purchase verification.');
        }

        await this.assertPlanCanBeSubscribed(userId, planEntity.code);

        // Cancel existing active subscription
        await this.subscriptionRepository.update(
            { userId, status: SubscriptionStatus.ACTIVE },
            { status: SubscriptionStatus.CANCELLED },
        );

        // Create new subscription
        const now = new Date();
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + (durationDays || planEntity.durationDays || 30));

        const subscription = this.subscriptionRepository.create({
            userId,
            plan: planEntity.code,
            planId: planEntity.id,
            planEntity,
            status: SubscriptionStatus.ACTIVE,
            startDate: now,
            endDate,
            paymentReference,
            paymentProvider: 'manual',
        });

        const saved = await this.subscriptionRepository.save(subscription);

        // Invalidate premium cache so swipe limits update immediately
        await this.updateUserPremiumState(
            userId,
            planEntity.code !== 'free',
            now,
            endDate,
            planEntity.id,
        );
        await this.invalidatePremiumCaches(userId);

        return saved;
    }

    async assertPlanCanBeSubscribed(userId: string, planCode: string): Promise<void> {
        const normalizedPlanCode = this.normalizePlanToken(planCode);
        if (!normalizedPlanCode || normalizedPlanCode === 'free') {
            return;
        }

        const activeSubscriptions = await this.subscriptionRepository.find({
            where: [
                { userId, status: SubscriptionStatus.ACTIVE },
                { userId, status: SubscriptionStatus.PAST_DUE },
                { userId, status: SubscriptionStatus.TRIAL },
            ],
            order: { createdAt: 'DESC' },
            relations: ['planEntity'],
        });

        const now = new Date();
        const hasActiveSamePlan = activeSubscriptions.some((subscription) =>
            this.blocksSamePlanSubscription(subscription, normalizedPlanCode, now),
        );

        if (hasActiveSamePlan) {
            throw new BadRequestException(
                'You already have an active subscription for this plan. Cancel it or wait until it expires before subscribing again.',
            );
        }
    }

    async getPublicPlans(): Promise<Plan[]> {
        return this.planRepository.find({
            where: { isActive: true, isVisible: true },
            order: { sortOrder: 'ASC', price: 'ASC' },
        });
    }

    async cancelSubscription(userId: string): Promise<void> {
        const sub = await this.subscriptionRepository.findOne({
            where: { userId, status: SubscriptionStatus.ACTIVE },
        });
        if (!sub) throw new NotFoundException('No active subscription found');

        sub.status = SubscriptionStatus.CANCELLED;
        await this.subscriptionRepository.save(sub);

        // Invalidate premium cache
        await this.updateUserPremiumState(userId, false, null, null, null);
        await this.invalidatePremiumCaches(userId);
    }

    async isPremium(userId: string): Promise<boolean> {
        const state = await this.syncUserPremiumState(userId);
        return state.isPremium;
    }

    async getPlanFeatures(plan: string) {
        const planCode = (plan || '').trim();
        const planEntity = await this.planRepository.findOne({
            where: this.planLookupWhere(planCode),
        });
        if (planEntity?.entitlements) {
            return planEntity.entitlements;
        }

        return {
            dailyLikes: 10,
            dailyCompliments: 0,
            monthlyRewinds: 2,
            weeklyBoosts: 0,
        };
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

        const planEntity = await this.planRepository.findOne({
            where: [
                { code: 'premium', isActive: true },
                { code: 'gold', isActive: true },
            ],
        });

        const subscription = this.subscriptionRepository.create({
            userId,
            plan: planEntity?.code ?? 'premium',
            planId: planEntity?.id ?? null,
            planEntity: planEntity ?? null,
            status: SubscriptionStatus.ACTIVE,
            startDate,
            endDate: expiryDate,
            paymentReference,
            paymentProvider: 'admin',
        });

        const saved = await this.subscriptionRepository.save(subscription);
        const now = new Date();
        await this.updateUserPremiumState(
            userId,
            startDate <= now && expiryDate > now,
            startDate,
            expiryDate,
            planEntity?.id ?? null,
        );
        await this.invalidatePremiumCaches(userId);

        return saved;
    }

    async removePremium(userId: string): Promise<void> {
        await this.subscriptionRepository.update(
            { userId, status: SubscriptionStatus.ACTIVE },
            { status: SubscriptionStatus.CANCELLED },
        );

        await this.updateUserPremiumState(userId, false, null, null, null);
        await this.invalidatePremiumCaches(userId);
    }

    async expirePremiums(now: Date = new Date()): Promise<string[]> {
        let expiredSubscriptions: Subscription[];
        try {
            expiredSubscriptions = await this.subscriptionRepository.find({
                where: [
                    { status: SubscriptionStatus.ACTIVE },
                    { status: SubscriptionStatus.PAST_DUE },
                    { status: SubscriptionStatus.TRIAL },
                ],
                select: ['id', 'userId', 'endDate', 'plan', 'planId'],
                relations: ['planEntity'],
            });
        } catch (error) {
            if (!this.isMissingPlanCodeColumnError(error)) {
                throw error;
            }

            this.logMissingPlanCodeColumnWarning('expirePremiums');
            expiredSubscriptions = await this.subscriptionRepository.find({
                where: [
                    { status: SubscriptionStatus.ACTIVE },
                    { status: SubscriptionStatus.PAST_DUE },
                    { status: SubscriptionStatus.TRIAL },
                ],
                select: ['id', 'userId', 'endDate', 'plan', 'planId'],
            });
        }

        const expiredUserIds = new Set<string>();

        for (const subscription of expiredSubscriptions) {
            const planCode = this.getSubscriptionPlanCode(subscription);
            const isNonFree = planCode !== 'free';
            if (
                isNonFree &&
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
            ids.map(async (userId) => {
                const freeSubscription = await this.ensureFreeSubscriptionForUser(userId, now);
                await this.updateUserPremiumState(
                    userId,
                    false,
                    null,
                    null,
                    freeSubscription.planId ?? freeSubscription.planEntity?.id ?? null,
                );
            }),
        );

        await Promise.all(ids.map((userId) => this.invalidatePremiumCaches(userId)));

        return ids;
    }

    async syncUserPremiumState(
        userId: string,
    ): Promise<{ isPremium: boolean; premiumStartDate: Date | null; premiumExpiryDate: Date | null }> {
        // Check both ACTIVE and PAST_DUE to support provider grace periods.
        let activeSubscription: Subscription | null;
        try {
            activeSubscription = await this.subscriptionRepository.findOne({
                where: [
                    { userId, status: SubscriptionStatus.ACTIVE },
                    { userId, status: SubscriptionStatus.PAST_DUE },
                    { userId, status: SubscriptionStatus.TRIAL },
                ],
                order: { endDate: 'DESC', createdAt: 'DESC' },
                relations: ['planEntity'],
            });
        } catch (error) {
            if (!this.isMissingPlanCodeColumnError(error)) {
                throw error;
            }

            this.logMissingPlanCodeColumnWarning('syncUserPremiumState');
            activeSubscription = await this.subscriptionRepository.findOne({
                where: [
                    { userId, status: SubscriptionStatus.ACTIVE },
                    { userId, status: SubscriptionStatus.PAST_DUE },
                    { userId, status: SubscriptionStatus.TRIAL },
                ],
                order: { endDate: 'DESC', createdAt: 'DESC' },
            });
        }

        const now = new Date();

        if (
            activeSubscription &&
            this.hasPremiumAccessSubscription(activeSubscription) &&
            (!activeSubscription.startDate || new Date(activeSubscription.startDate) <= now) &&
            (!activeSubscription.endDate || new Date(activeSubscription.endDate) > now)
        ) {
            const startDate = activeSubscription.startDate ? new Date(activeSubscription.startDate) : now;
            const expiryDate = activeSubscription.endDate ? new Date(activeSubscription.endDate) : null;

            const isPremium =
                activeSubscription.status === SubscriptionStatus.ACTIVE ||
                activeSubscription.status === SubscriptionStatus.PAST_DUE ||
                activeSubscription.status === SubscriptionStatus.TRIAL;

            await this.updateUserPremiumState(
                userId,
                isPremium,
                startDate,
                expiryDate,
                activeSubscription.planId ?? activeSubscription.planEntity?.id ?? null,
            );
            await this.invalidatePremiumCaches(userId);

            return {
                isPremium,
                premiumStartDate: startDate,
                premiumExpiryDate: expiryDate,
            };
        }

        if (
            activeSubscription &&
            this.getSubscriptionPlanCode(activeSubscription) !== 'free' &&
            activeSubscription.startDate &&
            new Date(activeSubscription.startDate) > now
        ) {
            const startDate = new Date(activeSubscription.startDate);
            const expiryDate = activeSubscription.endDate ? new Date(activeSubscription.endDate) : null;

            await this.updateUserPremiumState(
                userId,
                false,
                startDate,
                expiryDate,
                activeSubscription.planId ?? activeSubscription.planEntity?.id ?? null,
            );
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

            const freeSubscription = await this.ensureFreeSubscriptionForUser(userId, now);
            await this.updateUserPremiumState(
                userId,
                false,
                null,
                null,
                freeSubscription.planId ?? freeSubscription.planEntity?.id ?? null,
            );
            await this.invalidatePremiumCaches(userId);

            return {
                isPremium: false,
                premiumStartDate: null,
                premiumExpiryDate: null,
            };
        }

        await this.updateUserPremiumState(userId, false, null, null, null);
        await this.invalidatePremiumCaches(userId);

        return {
            isPremium: false,
            premiumStartDate: null,
            premiumExpiryDate: null,
        };
    }

    async updateUserPremiumState(
        userId: string,
        isPremium: boolean,
        premiumStartDate: Date | null,
        premiumExpiryDate: Date | null,
        subscriptionPlanId?: string | null,
    ): Promise<void> {
        try {
            const payload: Partial<User> = {
                isPremium,
                premiumStartDate,
                premiumExpiryDate,
            };

            if (subscriptionPlanId !== undefined) {
                payload.subscriptionPlanId = subscriptionPlanId;
            }

            await this.userRepository.update(userId, payload);
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

    private planLookupWhere(planRef: string, extra: Record<string, any> = {}): Record<string, any>[] {
        const byCode = { code: planRef, ...extra };
        if (!this.isUuid(planRef)) return [byCode];
        return [{ id: planRef, ...extra }, byCode];
    }

    private blocksSamePlanSubscription(subscription: Subscription, normalizedPlanCode: string, now: Date): boolean {
        const statusBlocks =
            subscription.status === SubscriptionStatus.ACTIVE ||
            subscription.status === SubscriptionStatus.PAST_DUE;
        if (!statusBlocks) {
            return false;
        }

        if (subscription.endDate && new Date(subscription.endDate) <= now) {
            return false;
        }

        const subscriptionPlanCode = this.getSubscriptionPlanCode(subscription);
        return subscriptionPlanCode === normalizedPlanCode;
    }

    private getSubscriptionPlanCode(subscription?: Partial<Subscription> | null): string {
        return this.normalizePlanToken(subscription?.planEntity?.code ?? subscription?.plan) || 'free';
    }

    private hasPremiumAccessSubscription(subscription?: Subscription | null): boolean {
        if (!subscription) {
            return false;
        }

        const planCode = this.getSubscriptionPlanCode(subscription);
        if (planCode === 'free') {
            return false;
        }

        return (
            subscription.status === SubscriptionStatus.ACTIVE ||
            subscription.status === SubscriptionStatus.PAST_DUE ||
            subscription.status === SubscriptionStatus.TRIAL
        );
    }

    private async ensureFreeSubscriptionForUser(
        userId: string,
        startDate: Date = new Date(),
    ): Promise<Subscription> {
        let freeSubscription: Subscription | null;
        try {
            freeSubscription = await this.subscriptionRepository.findOne({
                where: {
                    userId,
                    status: SubscriptionStatus.ACTIVE,
                    plan: 'free',
                },
                relations: ['planEntity'],
                order: { createdAt: 'DESC' },
            });
        } catch (error) {
            if (!this.isMissingPlanCodeColumnError(error)) {
                throw error;
            }

            this.logMissingPlanCodeColumnWarning('ensureFreeSubscriptionForUser');
            freeSubscription = await this.subscriptionRepository.findOne({
                where: {
                    userId,
                    status: SubscriptionStatus.ACTIVE,
                    plan: 'free',
                },
                order: { createdAt: 'DESC' },
            });
        }

        if (freeSubscription) {
            return freeSubscription;
        }

        const freePlan = await this.planRepository.findOne({
            where: { code: 'free', isActive: true },
        });

        const createdFreeSubscription = this.subscriptionRepository.create({
            userId,
            plan: freePlan?.code ?? 'free',
            planId: freePlan?.id ?? null,
            planEntity: freePlan ?? null,
            status: SubscriptionStatus.ACTIVE,
            startDate,
            endDate: null,
            paymentReference: 'AUTO_FREE_FALLBACK',
            paymentProvider: 'system',
        });

        return this.subscriptionRepository.save(createdFreeSubscription);
    }

    private normalizePlanToken(value?: string | null): string {
        return (value ?? '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
    }

    private logMissingPlanCodeColumnWarning(context: string): void {
        if (this.hasLoggedMissingPlanCodeColumn) {
            return;
        }

        this.hasLoggedMissingPlanCodeColumn = true;
        this.logger.warn(
            `plans.code column is missing in the database. Falling back to legacy subscriptions.plan in ${context}. Run migrations to restore dynamic plan support.`,
        );
    }

    private isUuid(value: string): boolean {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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
            message.includes('premiumExpiryDate') ||
            message.includes('subscriptionPlanId')
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
            message.includes('Subscription__Subscription_planEntity.code') ||
            message.includes('planEntity.code') ||
            message.includes('p.code') ||
            message.includes('relation "plans"')
        );
    }

    private async invalidatePremiumCaches(userId: string): Promise<void> {
        await Promise.all([
            this.redisService.del(`premium:${userId}`),
            this.redisService.del(`plan:${userId}`),
            this.redisService.del(`features:${userId}`),
            this.redisService.del(`entitlements:${userId}`),
        ]);
    }
}

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
    private stripeClient: Stripe | null | undefined = undefined;
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

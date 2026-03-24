import {
    Injectable,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
    Subscription,
    SubscriptionPlan,
    SubscriptionStatus,
} from '../../database/entities/subscription.entity';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class SubscriptionsService {
    constructor(
        @InjectRepository(Subscription)
        private readonly subscriptionRepository: Repository<Subscription>,
        private readonly redisService: RedisService,
    ) { }

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
        await this.redisService.del(`premium:${userId}`);

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
        await this.redisService.del(`premium:${userId}`);
    }

    async isPremium(userId: string): Promise<boolean> {
        const sub = await this.subscriptionRepository.findOne({
            where: { userId, status: SubscriptionStatus.ACTIVE },
        });
        return sub ? sub.plan !== SubscriptionPlan.FREE : false;
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
}

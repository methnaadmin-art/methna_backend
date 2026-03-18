import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual } from 'typeorm';
import { AnalyticsEvent, AnalyticsEventType } from '../../database/entities/analytics-event.entity';
import { User, UserStatus } from '../../database/entities/user.entity';
import { Match } from '../../database/entities/match.entity';
import { Like } from '../../database/entities/like.entity';
import { Message } from '../../database/entities/message.entity';
import { Subscription, SubscriptionPlan } from '../../database/entities/subscription.entity';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class AnalyticsService {
    private readonly logger = new Logger(AnalyticsService.name);

    constructor(
        @InjectRepository(AnalyticsEvent)
        private readonly analyticsRepository: Repository<AnalyticsEvent>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(Match)
        private readonly matchRepository: Repository<Match>,
        @InjectRepository(Like)
        private readonly likeRepository: Repository<Like>,
        @InjectRepository(Message)
        private readonly messageRepository: Repository<Message>,
        @InjectRepository(Subscription)
        private readonly subscriptionRepository: Repository<Subscription>,
        private readonly redisService: RedisService,
    ) { }

    // ─── EVENT TRACKING ─────────────────────────────────────

    async trackEvent(eventType: AnalyticsEventType, userId?: string, metadata?: Record<string, any>): Promise<void> {
        const today = new Date().toISOString().split('T')[0];
        await this.analyticsRepository.save({
            eventType,
            userId,
            metadata,
            eventDate: today,
        });

        // Increment daily counter in Redis for fast reads
        const counterKey = `analytics:${eventType}:${today}`;
        await this.redisService.incr(counterKey);
        // Set TTL of 90 days
        await this.redisService.expire(counterKey, 90 * 86400);
    }

    // ─── DAILY ACTIVE USERS ─────────────────────────────────

    async getDailyActiveUsers(date?: string): Promise<number> {
        const targetDate = date || new Date().toISOString().split('T')[0];
        const cacheKey = `analytics:dau:${targetDate}`;

        const cached = await this.redisService.get(cacheKey);
        if (cached) return parseInt(cached, 10);

        const count = await this.analyticsRepository
            .createQueryBuilder('event')
            .select('COUNT(DISTINCT event.userId)', 'count')
            .where('event.eventDate = :date', { date: targetDate })
            .where('event.eventType IN (:...types)', {
                types: [AnalyticsEventType.USER_LOGIN, AnalyticsEventType.USER_ACTIVE],
            })
            .getRawOne();

        const dau = parseInt(count?.count || '0', 10);
        await this.redisService.set(cacheKey, dau.toString(), 3600);
        return dau;
    }

    // ─── LIKE → MATCH CONVERSION ────────────────────────────

    async getLikeToMatchConversion(days: number = 30): Promise<{
        totalLikes: number;
        totalMatches: number;
        conversionRate: string;
    }> {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const totalLikes = await this.likeRepository.count({
            where: { isLike: true, createdAt: MoreThanOrEqual(since) },
        });

        const totalMatches = await this.matchRepository.count({
            where: { matchedAt: MoreThanOrEqual(since) },
        });

        const conversionRate = totalLikes > 0
            ? ((totalMatches / totalLikes) * 100).toFixed(2) + '%'
            : '0%';

        return { totalLikes, totalMatches, conversionRate };
    }

    // ─── USER RETENTION ─────────────────────────────────────

    async getUserRetention(cohortDays: number = 7): Promise<{
        day1: string;
        day3: string;
        day7: string;
        day30: string;
    }> {
        const cacheKey = `analytics:retention:${cohortDays}`;
        const cached = await this.redisService.getJson<any>(cacheKey);
        if (cached) return cached;

        const cohortStart = new Date(Date.now() - cohortDays * 24 * 60 * 60 * 1000);
        const cohortEnd = new Date(cohortStart.getTime() + 24 * 60 * 60 * 1000);

        // Users who signed up in the cohort window
        const cohortUsers = await this.userRepository
            .createQueryBuilder('user')
            .where('user.createdAt BETWEEN :start AND :end', { start: cohortStart, end: cohortEnd })
            .getCount();

        if (cohortUsers === 0) {
            const result = { day1: '0%', day3: '0%', day7: '0%', day30: '0%' };
            await this.redisService.setJson(cacheKey, result, 3600);
            return result;
        }

        const retentionAt = async (daysAfter: number): Promise<string> => {
            const targetDate = new Date(cohortStart.getTime() + daysAfter * 24 * 60 * 60 * 1000)
                .toISOString().split('T')[0];

            const active = await this.analyticsRepository
                .createQueryBuilder('event')
                .select('COUNT(DISTINCT event.userId)', 'count')
                .where('event.eventDate = :date', { date: targetDate })
                .andWhere('event.userId IN (SELECT id FROM users WHERE "createdAt" BETWEEN :start AND :end)', {
                    start: cohortStart,
                    end: cohortEnd,
                })
                .getRawOne();

            const count = parseInt(active?.count || '0', 10);
            return ((count / cohortUsers) * 100).toFixed(1) + '%';
        };

        const result = {
            day1: await retentionAt(1),
            day3: await retentionAt(3),
            day7: await retentionAt(7),
            day30: await retentionAt(30),
        };

        await this.redisService.setJson(cacheKey, result, 3600);
        return result;
    }

    // ─── MATCHES OVER TIME ──────────────────────────────────

    async getMatchesOverTime(days: number = 30): Promise<{ date: string; count: number }[]> {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const results = await this.matchRepository
            .createQueryBuilder('match')
            .select("TO_CHAR(match.matchedAt, 'YYYY-MM-DD')", 'date')
            .addSelect('COUNT(*)', 'count')
            .where('match.matchedAt >= :since', { since })
            .groupBy("TO_CHAR(match.matchedAt, 'YYYY-MM-DD')")
            .orderBy('date', 'ASC')
            .getRawMany();

        return results.map(r => ({ date: r.date, count: parseInt(r.count, 10) }));
    }

    // ─── COMPREHENSIVE ADMIN ANALYTICS ──────────────────────

    async getAdminAnalytics(): Promise<any> {
        const today = new Date().toISOString().split('T')[0];
        const cacheKey = `analytics:admin:${today}`;

        const cached = await this.redisService.getJson<any>(cacheKey);
        if (cached) return cached;

        const [
            dau,
            conversion,
            retention,
            matchesOverTime,
            totalUsers,
            activeUsers,
            premiumUsers,
            totalMessages,
        ] = await Promise.all([
            this.getDailyActiveUsers(),
            this.getLikeToMatchConversion(30),
            this.getUserRetention(7),
            this.getMatchesOverTime(30),
            this.userRepository.count(),
            this.userRepository.count({ where: { status: UserStatus.ACTIVE } }),
            this.subscriptionRepository.count({
                where: [
                    { plan: SubscriptionPlan.PREMIUM, status: 'active' as any },
                    { plan: SubscriptionPlan.GOLD, status: 'active' as any },
                ],
            }),
            this.messageRepository.count(),
        ]);

        // Weekly active users
        const wauDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const wau = await this.analyticsRepository
            .createQueryBuilder('event')
            .select('COUNT(DISTINCT event.userId)', 'count')
            .where('event.eventDate >= :date', { date: wauDate })
            .getRawOne();

        // Monthly active users
        const mauDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const mau = await this.analyticsRepository
            .createQueryBuilder('event')
            .select('COUNT(DISTINCT event.userId)', 'count')
            .where('event.eventDate >= :date', { date: mauDate })
            .getRawOne();

        const result = {
            engagement: {
                dau,
                wau: parseInt(wau?.count || '0', 10),
                mau: parseInt(mau?.count || '0', 10),
            },
            users: {
                total: totalUsers,
                active: activeUsers,
                premium: premiumUsers,
                premiumConversion: totalUsers > 0
                    ? ((premiumUsers / totalUsers) * 100).toFixed(2) + '%'
                    : '0%',
            },
            matching: {
                ...conversion,
                matchesOverTime,
            },
            retention,
            content: {
                totalMessages,
            },
        };

        await this.redisService.setJson(cacheKey, result, 1800); // 30 min cache
        return result;
    }
}

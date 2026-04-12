import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { AnalyticsEvent, AnalyticsEventType } from '../../database/entities/analytics-event.entity';
import { User, UserStatus } from '../../database/entities/user.entity';
import { Match } from '../../database/entities/match.entity';
import { Like, LikeType } from '../../database/entities/like.entity';
import { Message } from '../../database/entities/message.entity';
import { Subscription, SubscriptionStatus } from '../../database/entities/subscription.entity';
import { ProfileView } from '../../database/entities/profile-view.entity';

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
        @InjectRepository(ProfileView)
        private readonly profileViewRepository: Repository<ProfileView>,
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
    }

    // ─── DAILY ACTIVE USERS ─────────────────────────────────

    async getDailyActiveUsers(date?: string): Promise<number> {
        const targetDate = date || new Date().toISOString().split('T')[0];

        const count = await this.analyticsRepository
            .createQueryBuilder('event')
            .select('COUNT(DISTINCT event.userId)', 'count')
            .where('event.eventDate = :date', { date: targetDate })
            .where('event.eventType IN (:...types)', {
                types: [AnalyticsEventType.USER_LOGIN, AnalyticsEventType.USER_ACTIVE],
            })
            .getRawOne();

        return parseInt(count?.count || '0', 10);
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
        const cohortStart = new Date(Date.now() - cohortDays * 24 * 60 * 60 * 1000);
        const cohortEnd = new Date(cohortStart.getTime() + 24 * 60 * 60 * 1000);

        // Users who signed up in the cohort window
        const cohortUsers = await this.userRepository
            .createQueryBuilder('user')
            .where('user.createdAt BETWEEN :start AND :end', { start: cohortStart, end: cohortEnd })
            .getCount();

        if (cohortUsers === 0) {
            return { day1: '0%', day3: '0%', day7: '0%', day30: '0%' };
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

        return {
            day1: await retentionAt(1),
            day3: await retentionAt(3),
            day7: await retentionAt(7),
            day30: await retentionAt(30),
        };
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
            this.subscriptionRepository
                .createQueryBuilder('subscription')
                .leftJoin('subscription.planEntity', 'planEntity')
                .where('subscription.status IN (:...statuses)', {
                    statuses: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
                })
                .andWhere("COALESCE(planEntity.code, subscription.plan, 'free') != :freePlan", {
                    freePlan: 'free',
                })
                .getCount(),
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

        return {
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
    }

    async getProfileAnalytics(userId: string): Promise<any> {
        const todayAt = new Date().toISOString().split('T')[0];

        const [
            totalViews,
            todayViews,
            totalLikes,
            totalMatches,
            totalSuperLikes,
        ] = await Promise.all([
            this.profileViewRepository.count({ where: { viewedId: userId } }),
            this.profileViewRepository.createQueryBuilder('view')
                .where('view.viewedId = :userId', { userId })
                .andWhere("TO_CHAR(view.createdAt, 'YYYY-MM-DD') = :today", { today: todayAt })
                .getCount(),
            this.likeRepository.count({ where: { likedId: userId, isLike: true } }),
            this.matchRepository.count({
                where: [
                    { user1Id: userId },
                    { user2Id: userId },
                ],
            }),
            this.likeRepository.count({ where: { likedId: userId, type: LikeType.SUPER_LIKE } }),
        ]);

        // Get weekly views
        const weeklyViews: any[] = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const count = await this.profileViewRepository.createQueryBuilder('view')
                .where('view.viewedId = :userId', { userId })
                .andWhere("TO_CHAR(view.createdAt, 'YYYY-MM-DD') = :date", { date })
                .getCount();

            weeklyViews.push({
                day: date,
                views: count,
            });
        }

        const matchRate = totalViews > 0 ? (totalMatches / totalViews) * 100 : 0;

        return {
            totalViews,
            todayViews,
            totalLikes,
            totalMatches,
            totalSuperLikes,
            matchRate,
            weeklyViews,
        };
    }
}

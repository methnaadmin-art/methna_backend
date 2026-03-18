import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { User, UserStatus } from '../../database/entities/user.entity';
import { UserBehavior } from '../../database/entities/user-behavior.entity';
import { Boost } from '../../database/entities/boost.entity';
import { AnalyticsEvent, AnalyticsEventType } from '../../database/entities/analytics-event.entity';
import { Profile } from '../../database/entities/profile.entity';
import { Like } from '../../database/entities/like.entity';
import { Match, MatchStatus } from '../../database/entities/match.entity';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class JobsService {
    private readonly logger = new Logger(JobsService.name);

    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(UserBehavior)
        private readonly behaviorRepository: Repository<UserBehavior>,
        @InjectRepository(Boost)
        private readonly boostRepository: Repository<Boost>,
        @InjectRepository(AnalyticsEvent)
        private readonly analyticsRepository: Repository<AnalyticsEvent>,
        @InjectRepository(Profile)
        private readonly profileRepository: Repository<Profile>,
        @InjectRepository(Like)
        private readonly likeRepository: Repository<Like>,
        @InjectRepository(Match)
        private readonly matchRepository: Repository<Match>,
        private readonly redisService: RedisService,
    ) { }

    // ─── DEACTIVATE EXPIRED BOOSTS (every 5 minutes) ────────

    @Cron(CronExpression.EVERY_5_MINUTES)
    async deactivateExpiredBoosts(): Promise<void> {
        const result = await this.boostRepository
            .createQueryBuilder()
            .update(Boost)
            .set({ isActive: false })
            .where('isActive = true AND expiresAt < :now', { now: new Date() })
            .execute();

        if (result.affected && result.affected > 0) {
            this.logger.log(`Deactivated ${result.affected} expired boosts`);
        }
    }

    // ─── PRECOMPUTE COMPATIBILITY SCORES (every hour) ───────

    @Cron(CronExpression.EVERY_HOUR)
    async precomputeCompatibilityScores(): Promise<void> {
        this.logger.log('Starting compatibility score precomputation...');

        const activeUsers = await this.userRepository.find({
            where: { status: UserStatus.ACTIVE },
            select: ['id'],
            take: 500, // Process in batches
        });

        let computed = 0;

        for (const user of activeUsers) {
            try {
                const profile = await this.profileRepository.findOne({ where: { userId: user.id } });
                if (!profile) continue;

                // Get candidates (exclude blocked/swiped/matched)
                const existingLikes = await this.likeRepository.find({
                    where: { likerId: user.id },
                    select: ['likedId'],
                });
                const likedIds = existingLikes.map(l => l.likedId);

                const matches = await this.matchRepository.find({
                    where: [
                        { user1Id: user.id, status: MatchStatus.ACTIVE },
                        { user2Id: user.id, status: MatchStatus.ACTIVE },
                    ],
                });
                const matchedIds = matches.map(m => m.user1Id === user.id ? m.user2Id : m.user1Id);

                const excludeIds = [...new Set([user.id, ...likedIds, ...matchedIds])];

                const candidates = await this.profileRepository
                    .createQueryBuilder('p')
                    .where('p.userId NOT IN (:...excludeIds)', { excludeIds })
                    .take(50)
                    .getMany();

                const scores: Record<string, number> = {};
                for (const candidate of candidates) {
                    scores[candidate.userId] = this.computeScore(profile, candidate);
                }

                await this.redisService.setJson(`compat:${user.id}`, scores, 3600);
                computed++;
            } catch (error) {
                this.logger.error(`Failed to precompute for user ${user.id}`, (error as Error).message);
            }
        }

        this.logger.log(`Precomputed compatibility for ${computed} users`);
    }

    // ─── UPDATE USER BEHAVIOR STATS (every 6 hours) ─────────

    @Cron(CronExpression.EVERY_6_HOURS)
    async updateBehaviorStats(): Promise<void> {
        this.logger.log('Updating user behavior stats...');

        const behaviors = await this.behaviorRepository.find();

        for (const behavior of behaviors) {
            try {
                const totalMatches = await this.matchRepository.count({
                    where: [
                        { user1Id: behavior.userId, status: MatchStatus.ACTIVE },
                        { user2Id: behavior.userId, status: MatchStatus.ACTIVE },
                    ],
                });

                behavior.totalMatches = totalMatches;
                if (behavior.totalLikes > 0) {
                    behavior.likeToMatchRatio = totalMatches / behavior.totalLikes;
                }

                // Count active days
                const events = await this.analyticsRepository
                    .createQueryBuilder('e')
                    .select('COUNT(DISTINCT e.eventDate)', 'count')
                    .where('e.userId = :userId', { userId: behavior.userId })
                    .getRawOne();

                behavior.daysActive = parseInt(events?.count || '0', 10);

                await this.behaviorRepository.save(behavior);
            } catch (error) {
                this.logger.error(`Failed to update behavior for ${behavior.userId}`, (error as Error).message);
            }
        }

        this.logger.log(`Updated ${behaviors.length} behavior records`);
    }

    // ─── CLEAN UP OLD ANALYTICS (daily at midnight) ─────────

    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async cleanupOldAnalytics(): Promise<void> {
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

        const result = await this.analyticsRepository
            .createQueryBuilder()
            .delete()
            .where('createdAt < :date', { date: ninetyDaysAgo })
            .execute();

        if (result.affected && result.affected > 0) {
            this.logger.log(`Cleaned up ${result.affected} old analytics events`);
        }
    }

    // ─── HELPERS ────────────────────────────────────────────

    private computeScore(a: Profile, b: Profile): number {
        let score = 0;

        if (a.religiousLevel === b.religiousLevel) score += 30;
        else score += 10;

        if (a.marriageIntention && b.marriageIntention && a.marriageIntention === b.marriageIntention) score += 25;
        else if (a.marriageIntention && b.marriageIntention) score += 8;

        if (a.interests?.length && b.interests?.length) {
            const overlap = a.interests.filter(i => b.interests.includes(i));
            const ratio = overlap.length / Math.max(a.interests.length, b.interests.length);
            score += Math.round(ratio * 20);
        }

        if (a.familyPlans && b.familyPlans && a.familyPlans === b.familyPlans) score += 15;
        else if (a.familyPlans && b.familyPlans) score += 5;

        if (a.city && b.city && a.city.toLowerCase() === b.city.toLowerCase()) score += 10;
        else if (a.country && b.country && a.country.toLowerCase() === b.country.toLowerCase()) score += 5;

        return Math.min(score, 100);
    }
}

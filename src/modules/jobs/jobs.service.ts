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
import { Message } from '../../database/entities/message.entity';
import { Conversation } from '../../database/entities/conversation.entity';
import { Subscription, SubscriptionStatus } from '../../database/entities/subscription.entity';
import { RematchRequest, RematchStatus } from '../../database/entities/rematch-request.entity';
import { RedisService } from '../redis/redis.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

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
        @InjectRepository(Message)
        private readonly messageRepository: Repository<Message>,
        @InjectRepository(Conversation)
        private readonly conversationRepository: Repository<Conversation>,
        @InjectRepository(Subscription)
        private readonly subscriptionRepository: Repository<Subscription>,
        @InjectRepository(RematchRequest)
        private readonly rematchRepository: Repository<RematchRequest>,
        private readonly redisService: RedisService,
        private readonly subscriptionsService: SubscriptionsService,
    ) { }

    @Cron(CronExpression.EVERY_10_MINUTES)
    async expirePremiumSubscriptions(): Promise<void> {
        const expiredUserIds = await this.subscriptionsService.expirePremiums();

        if (expiredUserIds.length > 0) {
            this.logger.log(`Expired premium access for ${expiredUserIds.length} user(s)`);
        }
    }

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

                // Compute response rate
                const conversations = await this.conversationRepository.find({
                    where: [
                        { user1Id: behavior.userId },
                        { user2Id: behavior.userId },
                    ],
                    select: ['id', 'user1Id', 'user2Id'],
                });

                if (conversations.length > 0) {
                    const conversationIds = conversations.map(c => c.id);
                    let received = 0;
                    let replied = 0;

                    for (const conv of conversations) {
                        // Count messages received (sent by the other person)
                        const otherId = conv.user1Id === behavior.userId ? conv.user2Id : conv.user1Id;
                        const msgFromOther = await this.messageRepository.count({
                            where: { conversationId: conv.id, senderId: otherId },
                        });
                        const myReplies = await this.messageRepository.count({
                            where: { conversationId: conv.id, senderId: behavior.userId },
                        });

                        if (msgFromOther > 0) {
                            received++;
                            if (myReplies > 0) replied++;
                        }
                    }

                    behavior.messagesReceived = received;
                    behavior.messagesReplied = replied;
                    behavior.responseRate = received > 0 ? replied / received : 0;
                }

                await this.behaviorRepository.save(behavior);
            } catch (error) {
                this.logger.error(`Failed to update behavior for ${behavior.userId}`, (error as Error).message);
            }
        }

        this.logger.log(`Updated ${behaviors.length} behavior records`);
    }

    // ─── EXPIRE OLD REMATCH REQUESTS (daily) ─────────────────

    @Cron(CronExpression.EVERY_DAY_AT_1AM)
    async expireOldRematchRequests(): Promise<void> {
        const result = await this.rematchRepository
            .createQueryBuilder()
            .update(RematchRequest)
            .set({ status: RematchStatus.EXPIRED })
            .where('status = :status AND expiresAt < :now', {
                status: RematchStatus.PENDING,
                now: new Date(),
            })
            .execute();

        if (result.affected && result.affected > 0) {
            this.logger.log(`Expired ${result.affected} rematch requests`);
        }
    }

    // ─── IMPROVED VISITS FOR PREMIUM USERS (every 3 hours) ──

    @Cron(CronExpression.EVERY_3_HOURS)
    async boostPremiumVisibility(): Promise<void> {
        this.logger.log('Boosting premium user visibility...');

        const premiumSubs = await this.subscriptionRepository
            .createQueryBuilder('subscription')
            .leftJoin('subscription.planEntity', 'planEntity')
            .select('subscription.userId', 'userId')
            .where('subscription.status IN (:...statuses)', {
                statuses: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PENDING_CANCELLATION, SubscriptionStatus.PAST_DUE],
            })
            .andWhere("COALESCE(planEntity.code, subscription.plan, 'free') != :freePlan", {
                freePlan: 'free',
            })
            .getRawMany<{ userId: string }>();

        const premiumUserIds = premiumSubs.map(s => s.userId);
        if (premiumUserIds.length === 0) return;

        // Boost their activity score slightly to improve position in search/suggestions
        let boosted = 0;
        for (const userId of premiumUserIds) {
            const profile = await this.profileRepository.findOne({ where: { userId } });
            if (profile) {
                // Add a small boost capped at 100
                profile.activityScore = Math.min(100, (profile.activityScore || 0) + 2);
                await this.profileRepository.save(profile);
                boosted++;
            }
        }

        this.logger.log(`Boosted visibility for ${boosted} premium users`);
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

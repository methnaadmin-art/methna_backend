import {
    Injectable,
    BadRequestException,
    ForbiddenException,
    Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Like, LikeType } from '../../database/entities/like.entity';
import { Match, MatchStatus } from '../../database/entities/match.entity';
import { BlockedUser } from '../../database/entities/blocked-user.entity';
import { Subscription, SubscriptionPlan } from '../../database/entities/subscription.entity';
import { Profile } from '../../database/entities/profile.entity';
import { UserPreference } from '../../database/entities/user-preference.entity';
import { Conversation } from '../../database/entities/conversation.entity';
import { RematchRequest, RematchStatus } from '../../database/entities/rematch-request.entity';
import { CreateSwipeDto, SwipeAction } from './dto/swipe.dto';
import { RedisService } from '../redis/redis.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MonetizationService, FeatureFlag } from '../monetization/monetization.service';

const FREE_DAILY_SWIPE_LIMIT = 10;
const FREE_DAILY_SUPER_LIKE_LIMIT = 0;

@Injectable()
export class SwipesService {
    private readonly logger = new Logger(SwipesService.name);

    constructor(
        @InjectRepository(Like)
        private readonly likeRepository: Repository<Like>,
        @InjectRepository(Match)
        private readonly matchRepository: Repository<Match>,
        @InjectRepository(BlockedUser)
        private readonly blockedUserRepository: Repository<BlockedUser>,
        @InjectRepository(Subscription)
        private readonly subscriptionRepository: Repository<Subscription>,
        @InjectRepository(Profile)
        private readonly profileRepository: Repository<Profile>,
        @InjectRepository(UserPreference)
        private readonly preferenceRepository: Repository<UserPreference>,
        @InjectRepository(Conversation)
        private readonly conversationRepository: Repository<Conversation>,
        @InjectRepository(RematchRequest)
        private readonly rematchRepository: Repository<RematchRequest>,
        private readonly redisService: RedisService,
        private readonly notificationsService: NotificationsService,
        private readonly monetizationService: MonetizationService,
    ) { }

    async swipe(userId: string, dto: CreateSwipeDto) {
        const { targetUserId, action, complimentMessage } = dto;

        if (userId === targetUserId) {
            throw new BadRequestException('Cannot swipe on yourself');
        }

        // Validate compliment action has a message
        if (action === SwipeAction.COMPLIMENT && !complimentMessage) {
            throw new BadRequestException('Compliment action requires a message');
        }

        // Check if blocked
        const isBlocked = await this.blockedUserRepository.findOne({
            where: [
                { blockerId: userId, blockedId: targetUserId },
                { blockerId: targetUserId, blockedId: userId },
            ],
        });
        if (isBlocked) {
            throw new BadRequestException('Cannot interact with this user');
        }

        // Check duplicate swipe
        const existingSwipe = await this.likeRepository.findOne({
            where: { likerId: userId, likedId: targetUserId },
        });
        if (existingSwipe) {
            throw new BadRequestException('Already swiped on this user');
        }

        // Check limits
        await this.checkSwipeLimit(userId);
        if (action === SwipeAction.SUPER_LIKE) {
            await this.checkSuperLikeLimit(userId);
        }

        // Map SwipeAction to LikeType
        const likeTypeMap: Record<SwipeAction, LikeType> = {
            [SwipeAction.LIKE]: LikeType.LIKE,
            [SwipeAction.SUPER_LIKE]: LikeType.SUPER_LIKE,
            [SwipeAction.COMPLIMENT]: LikeType.COMPLIMENT,
            [SwipeAction.PASS]: LikeType.PASS,
        };

        const isPositive = action !== SwipeAction.PASS;

        const like = this.likeRepository.create({
            likerId: userId,
            likedId: targetUserId,
            type: likeTypeMap[action],
            isLike: isPositive,
            complimentMessage: action === SwipeAction.COMPLIMENT ? complimentMessage : undefined,
        });
        await this.likeRepository.save(like);
        await this.invalidateDiscoveryCaches(userId);

        // Notify target user for super-like or compliment
        if (action === SwipeAction.SUPER_LIKE) {
            this.notificationsService.createNotification(targetUserId, {
                type: 'super_like',
                title: 'Someone Super Liked you!',
                body: 'Someone really likes you. Check your likes!',
                data: { likerId: userId },
            }).catch(() => { });
        } else if (action === SwipeAction.COMPLIMENT) {
            this.notificationsService.createNotification(targetUserId, {
                type: 'compliment',
                title: 'You received a compliment!',
                body: complimentMessage || 'Someone sent you a compliment.',
                data: { likerId: userId },
            }).catch(() => { });
        }

        // If positive action, check for mutual match
        if (isPositive) {
            const mutualLike = await this.likeRepository.findOne({
                where: { likerId: targetUserId, likedId: userId, isLike: true },
            });

            if (mutualLike) {
                const match = await this.createMatch(userId, targetUserId);
                await this.invalidateDiscoveryCaches(targetUserId);
                this.logger.log(`Match created between ${userId} and ${targetUserId}`);
                return { liked: true, matched: true, matchId: match.id, action };
            }
        }

        return { liked: isPositive, matched: false, action };
    }

    // ─── WHO LIKED ME (premium feature) ─────────────────────

    async getWhoLikedMe(userId: string) {
        const isPremium = await this.isPremiumUser(userId);
        if (!isPremium) {
            // Free users only see the count
            const count = await this.likeRepository.count({
                where: { likedId: userId, isLike: true },
            });
            return { count, users: [], isPremiumFeature: true };
        }

        const likes = await this.likeRepository.find({
            where: { likedId: userId, isLike: true },
            relations: ['liker'],
            order: { createdAt: 'DESC' },
            take: 50,
        });

        return {
            count: likes.length,
            users: likes.map((l) => ({
                userId: l.likerId,
                firstName: l.liker?.firstName,
                lastName: l.liker?.lastName,
                type: l.type,
                complimentMessage: l.complimentMessage,
                createdAt: l.createdAt,
            })),
            isPremiumFeature: false,
        };
    }

    // ─── REWIND (Undo last swipe) ─────────────────────────────

    async rewind(userId: string) {
        // Find the user's most recent swipe
        const lastSwipe = await this.likeRepository.findOne({
            where: { likerId: userId },
            order: { createdAt: 'DESC' },
        });

        if (!lastSwipe) {
            throw new BadRequestException('No swipe to undo');
        }

        // Check rewind limits via monetization
        const result = await this.monetizationService.useRewind(userId);

        // If a match was created from this swipe, remove it
        const [id1, id2] = [userId, lastSwipe.likedId].sort();
        const match = await this.matchRepository.findOne({
            where: { user1Id: id1, user2Id: id2, status: MatchStatus.ACTIVE },
        });

        if (match) {
            // Delete conversation for this match
            await this.conversationRepository.delete({ matchId: match.id });
            await this.matchRepository.remove(match);
        }

        // Remove the swipe
        await this.likeRepository.remove(lastSwipe);
        await this.invalidateDiscoveryCaches(userId, lastSwipe.likedId);

        this.logger.log(`User ${userId} rewound swipe on ${lastSwipe.likedId}`);

        return {
            rewound: true,
            undoneSwipe: {
                targetUserId: lastSwipe.likedId,
                action: lastSwipe.type,
            },
            remainingRewinds: result.remaining,
        };
    }

    // ─── COMPATIBILITY ALGORITHM ────────────────────────────
    // Weighted: religion 40%, marriage intentions 25%, lifestyle 20%, hobbies 15%

    async getCompatibilityScore(userId: string, targetUserId: string): Promise<number> {
        const [profile1, profile2] = await Promise.all([
            this.profileRepository.findOne({ where: { userId } }),
            this.profileRepository.findOne({ where: { userId: targetUserId } }),
        ]);

        if (!profile1 || !profile2) return 0;

        let score = 0;

        // Religion match (40%)
        if (profile1.religiousLevel && profile2.religiousLevel) {
            if (profile1.religiousLevel === profile2.religiousLevel) {
                score += 40;
            } else {
                // Partial match for adjacent levels
                const levels = ['very_practicing', 'practicing', 'moderate', 'liberal'];
                const idx1 = levels.indexOf(profile1.religiousLevel);
                const idx2 = levels.indexOf(profile2.religiousLevel);
                const diff = Math.abs(idx1 - idx2);
                if (diff === 1) score += 25;
                else if (diff === 2) score += 10;
            }
        }

        // Marriage intentions (25%)
        if (profile1.marriageIntention && profile2.marriageIntention) {
            if (profile1.marriageIntention === profile2.marriageIntention) {
                score += 25;
            } else {
                score += 10; // Partial for any defined intention
            }
        }

        // Lifestyle match (20%) - workout, sleep, social media, living situation
        let lifestyleMatch = 0;
        let lifestyleTotal = 0;
        if (profile1.workoutFrequency && profile2.workoutFrequency) {
            lifestyleTotal++;
            if (profile1.workoutFrequency === profile2.workoutFrequency) lifestyleMatch++;
        }
        if (profile1.sleepSchedule && profile2.sleepSchedule) {
            lifestyleTotal++;
            if (profile1.sleepSchedule === profile2.sleepSchedule) lifestyleMatch++;
        }
        if (profile1.socialMediaUsage && profile2.socialMediaUsage) {
            lifestyleTotal++;
            if (profile1.socialMediaUsage === profile2.socialMediaUsage) lifestyleMatch++;
        }
        if (profile1.livingSituation && profile2.livingSituation) {
            lifestyleTotal++;
            if (profile1.livingSituation === profile2.livingSituation) lifestyleMatch++;
        }
        if (lifestyleTotal > 0) {
            score += Math.round((lifestyleMatch / lifestyleTotal) * 20);
        }

        // Hobbies/Interests match (15%)
        if (profile1.interests?.length && profile2.interests?.length) {
            const set1 = new Set(profile1.interests.map((i) => i.toLowerCase()));
            const common = profile2.interests.filter((i) => set1.has(i.toLowerCase()));
            const maxLen = Math.max(profile1.interests.length, profile2.interests.length);
            score += Math.round((common.length / maxLen) * 15);
        }

        return Math.min(100, score);
    }

    // ─── PRIVATE HELPERS ────────────────────────────────────

    private async createMatch(user1Id: string, user2Id: string): Promise<Match> {
        const [first, second] = [user1Id, user2Id].sort();

        const match = this.matchRepository.create({
            user1Id: first,
            user2Id: second,
            status: MatchStatus.ACTIVE,
        });
        const savedMatch = await this.matchRepository.save(match);

        // Create conversation for this match
        const conversation = this.conversationRepository.create({
            user1Id: first,
            user2Id: second,
            matchId: savedMatch.id,
        });
        await this.conversationRepository.save(conversation);

        // Notify both users
        await Promise.all([
            this.notificationsService.createNotification(user1Id, {
                type: 'match',
                title: 'New Match!',
                body: 'You have a new match! Start a conversation.',
                data: { matchId: savedMatch.id, userId: user2Id },
            }),
            this.notificationsService.createNotification(user2Id, {
                type: 'match',
                title: 'New Match!',
                body: 'You have a new match! Start a conversation.',
                data: { matchId: savedMatch.id, userId: user1Id },
            }),
        ]);

        return savedMatch;
    }

    private async checkSwipeLimit(userId: string): Promise<void> {
        if (await this.isPremiumUser(userId)) return;

        const key = `swipes:${userId}:${new Date().toISOString().split('T')[0]}`;
        const allowed = await this.redisService.checkRateLimit(key, FREE_DAILY_SWIPE_LIMIT, 86400);
        if (!allowed) {
            throw new ForbiddenException('Daily swipe limit reached. Upgrade to Premium for unlimited swipes.');
        }
    }

    private async checkSuperLikeLimit(userId: string): Promise<void> {
        if (await this.isPremiumUser(userId)) return;

        const key = `superlike:${userId}:${new Date().toISOString().split('T')[0]}`;
        const allowed = await this.redisService.checkRateLimit(key, FREE_DAILY_SUPER_LIKE_LIMIT, 86400);
        if (!allowed) {
            throw new ForbiddenException('Daily super-like limit reached. Upgrade for more.');
        }
    }

    private async isPremiumUser(userId: string): Promise<boolean> {
        const cacheKey = `premium:${userId}`;
        const cached = await this.redisService.get(cacheKey);
        if (cached !== null) return cached === '1';

        const subscription = await this.subscriptionRepository.findOne({
            where: { userId, status: 'active' as any },
        });
        const isPremium = !!subscription && subscription.plan !== SubscriptionPlan.FREE;
        await this.redisService.set(cacheKey, isPremium ? '1' : '0', 300); // 5 min TTL
        return isPremium;
    }

    // ─── REMATCH / SECOND CHANCE (premium feature) ────────

    private async invalidateDiscoveryCaches(...userIds: string[]): Promise<void> {
        const uniqueIds = [
            ...new Set(userIds.map((id) => id?.trim()).filter((id): id is string => !!id)),
        ];
        if (uniqueIds.length === 0) return;

        await Promise.all(
            uniqueIds.flatMap((id) => [
                this.redisService.del(`excludeIds:${id}`),
                this.redisService.del(`discovery:${id}`),
                this.redisService.del(`suggestions:${id}`),
                this.redisService.delByPattern(`search:${id}:*`),
            ]),
        );
    }

    async requestRematch(userId: string, targetUserId: string, message?: string) {
        // Verify premium feature
        const hasFeature = await this.monetizationService.hasFeature(userId, FeatureFlag.REMATCH);
        if (!hasFeature) {
            throw new ForbiddenException('Rematch is a Premium feature. Upgrade to request a second chance.');
        }

        if (userId === targetUserId) {
            throw new BadRequestException('Cannot rematch with yourself');
        }

        // Must have previously passed or unmatched this user
        const previousSwipe = await this.likeRepository.findOne({
            where: { likerId: userId, likedId: targetUserId },
        });
        const previousUnmatch = await this.matchRepository.findOne({
            where: [
                { user1Id: userId, user2Id: targetUserId, status: MatchStatus.UNMATCHED },
                { user1Id: targetUserId, user2Id: userId, status: MatchStatus.UNMATCHED },
            ],
        });

        if (!previousSwipe && !previousUnmatch) {
            throw new BadRequestException('You can only request a rematch with someone you previously passed or unmatched');
        }

        // Check for existing pending rematch
        const existing = await this.rematchRepository.findOne({
            where: { requesterId: userId, targetId: targetUserId, status: RematchStatus.PENDING },
        });
        if (existing) {
            throw new BadRequestException('Rematch request already pending');
        }

        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        const request = this.rematchRepository.create({
            requesterId: userId,
            targetId: targetUserId,
            message,
            status: RematchStatus.PENDING,
            expiresAt,
        });
        const saved = await this.rematchRepository.save(request);

        // Notify target
        await this.notificationsService.createNotification(targetUserId, {
            type: 'like',
            title: 'Second Chance Request',
            body: message || 'Someone wants a second chance to connect with you!',
            data: { rematchRequestId: saved.id, requesterId: userId },
        });

        return { requestId: saved.id, status: 'pending', expiresAt };
    }

    async acceptRematch(userId: string, requestId: string) {
        const request = await this.rematchRepository.findOne({
            where: { id: requestId, targetId: userId, status: RematchStatus.PENDING },
        });
        if (!request) {
            throw new BadRequestException('Rematch request not found or already resolved');
        }

        if (request.expiresAt && new Date() > request.expiresAt) {
            request.status = RematchStatus.EXPIRED;
            await this.rematchRepository.save(request);
            throw new BadRequestException('Rematch request has expired');
        }

        request.status = RematchStatus.ACCEPTED;
        await this.rematchRepository.save(request);

        // Remove old pass/like so a new match can form
        await this.likeRepository.delete({ likerId: request.requesterId, likedId: userId });
        await this.likeRepository.delete({ likerId: userId, likedId: request.requesterId });

        // Create mutual match
        const match = await this.createMatch(request.requesterId, userId);

        this.logger.log(`Rematch accepted: ${request.requesterId} <-> ${userId}`);

        return { matched: true, matchId: match.id };
    }

    async rejectRematch(userId: string, requestId: string) {
        const request = await this.rematchRepository.findOne({
            where: { id: requestId, targetId: userId, status: RematchStatus.PENDING },
        });
        if (!request) {
            throw new BadRequestException('Rematch request not found or already resolved');
        }

        request.status = RematchStatus.REJECTED;
        await this.rematchRepository.save(request);

        return { rejected: true };
    }

    async getMyRematchRequests(userId: string) {
        const received = await this.rematchRepository.find({
            where: { targetId: userId, status: RematchStatus.PENDING },
            relations: ['requester'],
            order: { createdAt: 'DESC' },
        });

        return received.map(r => ({
            id: r.id,
            requesterId: r.requesterId,
            firstName: r.requester?.firstName,
            lastName: r.requester?.lastName,
            message: r.message,
            expiresAt: r.expiresAt,
            createdAt: r.createdAt,
        }));
    }
}

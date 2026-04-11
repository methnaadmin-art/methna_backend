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
import { Profile } from '../../database/entities/profile.entity';
import { UserPreference } from '../../database/entities/user-preference.entity';
import { Conversation } from '../../database/entities/conversation.entity';
import { RematchRequest, RematchStatus } from '../../database/entities/rematch-request.entity';
import { CreateSwipeDto, SwipeAction } from './dto/swipe.dto';
import { RedisService } from '../redis/redis.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MonetizationService, FeatureFlag } from '../monetization/monetization.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

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
        private readonly subscriptionsService: SubscriptionsService,
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

        // Notify target user for like actions
        if (
            action === SwipeAction.LIKE ||
            action === SwipeAction.SUPER_LIKE ||
            action === SwipeAction.COMPLIMENT
        ) {
            this.sendLikeNotification(targetUserId, userId, action, complimentMessage).catch(() => { });
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

    // ??? WHO LIKED ME (premium feature) ?????????????????????

    async getWhoLikedMe(userId: string) {
        const isPremium = await this.isPremiumUser(userId);

        const likes = await this.likeRepository.find({
            where: { likedId: userId, isLike: true },
            relations: ['liker'],
            order: { createdAt: 'DESC' },
            take: 50,
        });

        // Filter out users that are already matched
        const matchedUserIds = new Set<string>();
        const activeMatches = await this.matchRepository.find({
            where: [
                { user1Id: userId, status: MatchStatus.ACTIVE },
                { user2Id: userId, status: MatchStatus.ACTIVE },
            ],
        });
        for (const m of activeMatches) {
            matchedUserIds.add(m.user1Id === userId ? m.user2Id : m.user1Id);
        }
        const filteredLikes = likes.filter(l => !matchedUserIds.has(l.likerId));

        if (!isPremium) {
            // Non-premium: return anonymized data for blurred card display
            const photos = filteredLikes.length > 0
                ? await this.profileRepository
                    .createQueryBuilder('profile')
                    .leftJoinAndSelect('profile.user', 'user')
                    .where('profile.userId IN (:...userIds)', {
                        userIds: filteredLikes.map(l => l.likerId),
                    })
                    .getMany()
                : [];
            const profileMap = new Map(photos.map(p => [p.userId, p]));

            return {
                count: filteredLikes.length,
                users: filteredLikes.map((l) => {
                    const profile = profileMap.get(l.likerId);
                    return {
                        userId: l.likerId,
                        // Anonymized: no name, only age/city for teaser
                        firstName: null,
                        lastName: null,
                        age: profile?.dateOfBirth
                            ? Math.floor((Date.now() - new Date(profile.dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
                            : null,
                        city: profile?.city ?? null,
                        type: l.type,
                        isBlurred: true,
                        createdAt: l.createdAt,
                    };
                }),
                isPremiumFeature: true,
            };
        }

        return {
            count: filteredLikes.length,
            users: filteredLikes.map((l) => ({
                userId: l.likerId,
                firstName: l.liker?.firstName,
                lastName: l.liker?.lastName,
                type: l.type,
                complimentMessage: l.complimentMessage,
                isBlurred: false,
                createdAt: l.createdAt,
            })),
            isPremiumFeature: false,
        };
    }

    // ─── INTERACTIONS (all sent likes/passes) ─────────────────

    async getInteractions(userId: string, limit: number = 120) {
        const allSwipes = await this.likeRepository.find({
            where: { likerId: userId },
            relations: ['liked'],
            order: { createdAt: 'DESC' },
            take: Math.min(limit, 500),
        });

        const liked: any[] = [];
        const passed: any[] = [];

        for (const swipe of allSwipes) {
            const entry = {
                userId: swipe.likedId,
                firstName: swipe.liked?.firstName ?? null,
                lastName: swipe.liked?.lastName ?? null,
                action: swipe.isLike ? 'like' : 'pass',
                type: swipe.type,
                complimentMessage: swipe.complimentMessage ?? null,
                createdAt: swipe.createdAt,
            };
            if (swipe.isLike) {
                liked.push(entry);
            } else {
                passed.push(entry);
            }
        }

        return { liked, passed, total: allSwipes.length };
    }

    async getLikesSent(userId: string) {
        const likes = await this.likeRepository.find({
            where: { likerId: userId, isLike: true },
            relations: ['liked'],
            order: { createdAt: 'DESC' },
            take: 100,
        });

        return {
            count: likes.length,
            users: likes.map((l) => ({
                userId: l.likedId,
                firstName: l.liked?.firstName ?? null,
                lastName: l.liked?.lastName ?? null,
                type: l.type,
                complimentMessage: l.complimentMessage ?? null,
                createdAt: l.createdAt,
            })),
        };
    }

    // ??? REWIND (Undo last swipe) ?????????????????????????????

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

    // ??? COMPATIBILITY ALGORITHM ????????????????????????????
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

    // ??? PRIVATE HELPERS ????????????????????????????????????

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
                userId: user2Id,
                conversationId: conversation.id,
                title: 'New Match!',
                body: 'You have a new match! Start a conversation.',
                extraData: { matchId: savedMatch.id },
            }),
            this.notificationsService.createNotification(user2Id, {
                type: 'match',
                userId: user1Id,
                conversationId: conversation.id,
                title: 'New Match!',
                body: 'You have a new match! Start a conversation.',
                extraData: { matchId: savedMatch.id },
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

        const isPremium = await this.subscriptionsService.isPremium(userId);

        await this.redisService.set(cacheKey, isPremium ? '1' : '0', 300); // 5 min TTL
        return isPremium;
    }

    private async sendLikeNotification(
        targetUserId: string,
        likerId: string,
        action: SwipeAction,
        complimentMessage?: string,
    ): Promise<void> {
        const recipientIsPremium = await this.isPremiumUser(targetUserId);
        const likeKind = this.mapSwipeActionToNotificationKind(action);
        const title = recipientIsPremium ? 'New like' : 'Someone liked you';
        const body = recipientIsPremium
            ? (action === SwipeAction.COMPLIMENT && complimentMessage
                ? complimentMessage
                : 'Open Methna to see who is interested in you.')
            : 'Upgrade to Premium to see who liked you.';

        await this.notificationsService.createNotification(targetUserId, {
            type: 'like',
            userId: recipientIsPremium ? likerId : '',
            title,
            body,
            extraData: {
                likeKind,
                complimentMessage: complimentMessage || undefined,
                isAnonymousLike: !recipientIsPremium,
            },
        });
    }

    private mapSwipeActionToNotificationKind(action: SwipeAction): LikeType {
        switch (action) {
            case SwipeAction.SUPER_LIKE:
                return LikeType.SUPER_LIKE;
            case SwipeAction.COMPLIMENT:
                return LikeType.COMPLIMENT;
            case SwipeAction.LIKE:
            default:
                return LikeType.LIKE;
        }
    }

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
    // Rematch / second chance (premium feature)

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
            type: 'rematch',
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



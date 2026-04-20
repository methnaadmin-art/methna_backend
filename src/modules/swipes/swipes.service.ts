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
import { User, UserStatus } from '../../database/entities/user.entity';

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
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
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

        const isPositive = action !== SwipeAction.PASS;
        if (!isPositive) {
            const passResponse = await this.recordPassSwipe(userId, targetUserId);
            return passResponse;
        }

        const blockedStatuses = [UserStatus.BANNED, UserStatus.CLOSED, UserStatus.DEACTIVATED];
        const targetUser = await this.userRepository.findOne({
            where: { id: targetUserId },
            select: ['id', 'status'],
        });

        // Target user must exist and not be banned/closed/deactivated
        if (!targetUser) {
            throw new BadRequestException('This user is no longer available.');
        }
        if (blockedStatuses.includes(targetUser.status as UserStatus)) {
            throw new BadRequestException('This user is no longer available.');
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

        // Map SwipeAction to LikeType
        const likeTypeMap: Record<SwipeAction, LikeType> = {
            [SwipeAction.LIKE]: LikeType.LIKE,
            [SwipeAction.SUPER_LIKE]: LikeType.SUPER_LIKE,
            [SwipeAction.COMPLIMENT]: LikeType.COMPLIMENT,
            [SwipeAction.PASS]: LikeType.PASS,
        };

        const existingSwipe = await this.likeRepository.findOne({
            where: { likerId: userId, likedId: targetUserId },
        });

        // Check duplicate swipe. Allow a one-way upgrade from PASS -> LIKE/SUPER_LIKE/COMPLIMENT.
        if (existingSwipe) {
            const canUpgradePassToPositive = existingSwipe.isLike === false && isPositive;
            if (!canUpgradePassToPositive) {
                const existingActiveMatch = await this.findActiveMatch(userId, targetUserId);
                return {
                    liked: existingSwipe.isLike,
                    matched: !!existingActiveMatch,
                    matchId: existingActiveMatch?.id ?? null,
                    action: existingSwipe.type,
                    duplicate: true,
                };
            }

            if (action === SwipeAction.LIKE) {
                await this.monetizationService.useLike(userId);
            } else if (action === SwipeAction.SUPER_LIKE) {
                await this.monetizationService.useSuperLike(userId);
            } else if (action === SwipeAction.COMPLIMENT) {
                await this.monetizationService.useComplimentCredit(userId);
            }

            existingSwipe.type = likeTypeMap[action];
            existingSwipe.isLike = true;
            existingSwipe.complimentMessage =
                action === SwipeAction.COMPLIMENT ? (complimentMessage ?? '') : '';

            await this.likeRepository.save(existingSwipe);
            this.scheduleDiscoveryCacheInvalidation(userId);

            this.sendLikeNotification(targetUserId, userId, action, complimentMessage).catch(() => { });

            const mutualLike = await this.likeRepository.findOne({
                where: { likerId: targetUserId, likedId: userId, isLike: true },
            });

            if (mutualLike) {
                const match = await this.createMatch(userId, targetUserId);
                this.scheduleDiscoveryCacheInvalidation(targetUserId, userId);
                this.logger.log(`Match created between ${userId} and ${targetUserId} (upgraded pass)`);
                return { liked: true, matched: true, matchId: match.id, action, upgradedFromPass: true };
            }

            return { liked: true, matched: false, action, upgradedFromPass: true };
        }

        if (action === SwipeAction.LIKE) {
            await this.monetizationService.useLike(userId);
        } else if (action === SwipeAction.SUPER_LIKE) {
            await this.monetizationService.useSuperLike(userId);
        } else if (action === SwipeAction.COMPLIMENT) {
            await this.monetizationService.useComplimentCredit(userId);
        }

        const like = this.likeRepository.create({
            likerId: userId,
            likedId: targetUserId,
            type: likeTypeMap[action],
            isLike: isPositive,
            complimentMessage: action === SwipeAction.COMPLIMENT ? complimentMessage : undefined,
        });

        try {
            await this.likeRepository.save(like);
        } catch (saveError: any) {
            // Handle FK violation race condition: target user deleted between check and insert
            const pgCode = saveError?.code ?? saveError?.driverError?.code;
            if (pgCode === '23503') {
                this.logger.warn(`Swipe FK violation: target user ${targetUserId} no longer exists`);
                throw new BadRequestException('This user is no longer available.');
            }
            throw saveError;
        }

        this.scheduleDiscoveryCacheInvalidation(userId);

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
                this.scheduleDiscoveryCacheInvalidation(targetUserId, userId);
                this.logger.log(`Match created between ${userId} and ${targetUserId}`);
                return { liked: true, matched: true, matchId: match.id, action };
            }
        }

        return { liked: isPositive, matched: false, action };
    }

    // ??? WHO LIKED ME (premium feature) ?????????????????????

    async getWhoLikedMe(userId: string) {
        const canSeeWhoLikedYou = await this.monetizationService.hasFeature(
            userId,
            FeatureFlag.SEE_WHO_LIKED,
        );

        const likes = await this.likeRepository.find({
            where: { likedId: userId, isLike: true },
            relations: ['liker'],
            order: { createdAt: 'DESC' },
            take: 50,
        });

        // Filter out likes from banned/closed/deactivated users
        const invisibleStatuses = [UserStatus.BANNED, UserStatus.CLOSED, UserStatus.DEACTIVATED];
        const visibleLikes = likes.filter(l =>
            !l.liker || !invisibleStatuses.includes(l.liker.status as UserStatus),
        );

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
        const filteredLikes = visibleLikes.filter(l => !matchedUserIds.has(l.likerId));

        if (!canSeeWhoLikedYou) {
            return {
                count: filteredLikes.length,
                users: filteredLikes.map((l, index) => ({
                    id: `locked_like_${index}`,
                    userId: `locked_like_${index}`,
                    firstName: null,
                    lastName: null,
                    type: l.type,
                    isBlurred: true,
                    locked: true,
                    requiresPremium: true,
                    createdAt: l.createdAt,
                })),
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

        const matchedUserIds = await this.getMatchedUserIdsSet(userId);
        const invisibleStatuses = [UserStatus.BANNED, UserStatus.CLOSED, UserStatus.DEACTIVATED];

        const liked: any[] = [];
        const passed: any[] = [];

        for (const swipe of allSwipes) {
            if (swipe.liked && invisibleStatuses.includes(swipe.liked.status as UserStatus)) {
                continue;
            }

            const entry = {
                userId: swipe.likedId,
                firstName: swipe.liked?.firstName ?? null,
                lastName: swipe.liked?.lastName ?? null,
                action: swipe.isLike ? 'like' : 'pass',
                type: swipe.type,
                complimentMessage: swipe.complimentMessage ?? null,
                matched: matchedUserIds.has(swipe.likedId),
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

        const matchedUserIds = await this.getMatchedUserIdsSet(userId);
        const invisibleStatuses = [UserStatus.BANNED, UserStatus.CLOSED, UserStatus.DEACTIVATED];
        const visibleLikes = likes.filter(
            (like) => !like.liked || !invisibleStatuses.includes(like.liked.status as UserStatus),
        );

        return {
            count: visibleLikes.length,
            users: visibleLikes.map((l) => ({
                userId: l.likedId,
                firstName: l.liked?.firstName ?? null,
                lastName: l.liked?.lastName ?? null,
                type: l.type,
                complimentMessage: l.complimentMessage ?? null,
                matched: matchedUserIds.has(l.likedId),
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
        if (lastSwipe.type === LikeType.PASS) {
            void this.redisService
                .del(this.buildPassSeenCacheKey(userId, lastSwipe.likedId))
                .catch(() => undefined);
        }
        this.scheduleDiscoveryCacheInvalidation(userId, lastSwipe.likedId);

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

        let match = await this.matchRepository.findOne({
            where: { user1Id: first, user2Id: second },
        });
        let transitionedToActive = false;

        if (!match) {
            try {
                const created = this.matchRepository.create({
                    user1Id: first,
                    user2Id: second,
                    status: MatchStatus.ACTIVE,
                });
                match = await this.matchRepository.save(created);
                transitionedToActive = true;
            } catch (error) {
                if (!this.isUniqueConstraintViolation(error)) {
                    throw error;
                }

                match = await this.matchRepository.findOne({
                    where: { user1Id: first, user2Id: second },
                });
            }
        }

        if (!match) {
            throw new BadRequestException('Unable to create match at the moment. Please try again.');
        }

        if (match.status !== MatchStatus.ACTIVE) {
            match.status = MatchStatus.ACTIVE;
            match = await this.matchRepository.save(match);
            transitionedToActive = true;
        }

        let conversation = await this.conversationRepository.findOne({
            where: { user1Id: first, user2Id: second },
        });

        if (!conversation) {
            try {
                const createdConversation = this.conversationRepository.create({
                    user1Id: first,
                    user2Id: second,
                    matchId: match.id,
                    isActive: true,
                    isLocked: false,
                    lockReason: null,
                });
                conversation = await this.conversationRepository.save(createdConversation);
            } catch (error) {
                if (!this.isUniqueConstraintViolation(error)) {
                    throw error;
                }

                conversation = await this.conversationRepository.findOne({
                    where: { user1Id: first, user2Id: second },
                });
            }
        }

        if (!conversation) {
            throw new BadRequestException('Unable to open conversation for this match.');
        }

        let shouldNotify = transitionedToActive;
        if (
            conversation.matchId !== match.id ||
            conversation.isActive !== true ||
            conversation.isLocked === true ||
            conversation.lockReason
        ) {
            conversation.matchId = match.id;
            conversation.isActive = true;
            conversation.isLocked = false;
            conversation.lockReason = null;
            conversation = await this.conversationRepository.save(conversation);
            shouldNotify = true;
        }

        if (shouldNotify) {
            const matchEventKey = `match:${match.id}`;
            void Promise.all([
                this.notificationsService.createNotification(user1Id, {
                    type: 'match',
                    userId: user2Id,
                    conversationId: conversation.id,
                    title: 'New Match!',
                    body: 'You have a new match! Start a conversation.',
                    extraData: {
                        matchId: match.id,
                        route: '/chat',
                        targetScreen: 'conversation',
                        eventKey: matchEventKey,
                    },
                }),
                this.notificationsService.createNotification(user2Id, {
                    type: 'match',
                    userId: user1Id,
                    conversationId: conversation.id,
                    title: 'New Match!',
                    body: 'You have a new match! Start a conversation.',
                    extraData: {
                        matchId: match.id,
                        route: '/chat',
                        targetScreen: 'conversation',
                        eventKey: matchEventKey,
                    },
                }),
            ]).catch((error) => {
                this.logger.warn(
                    `Failed to send match notifications for match=${match.id}: ${error?.message ?? error}`,
                );
            });
        }

        return match;
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
        const canSeeWhoLikedYou = await this.monetizationService.hasFeature(
            targetUserId,
            FeatureFlag.SEE_WHO_LIKED,
        );
        const likeKind = this.mapSwipeActionToNotificationKind(action);
        const title = canSeeWhoLikedYou ? 'New like' : 'Someone liked you';
        const body = canSeeWhoLikedYou
            ? (action === SwipeAction.COMPLIMENT && complimentMessage
                ? complimentMessage
                : 'Open Methna to see who is interested in you.')
            : 'Upgrade to Premium to see who liked you.';

        await this.notificationsService.createNotification(targetUserId, {
            type: 'like',
            userId: canSeeWhoLikedYou ? likerId : '',
            title,
            body,
            extraData: {
                likeKind,
                complimentMessage: complimentMessage || undefined,
                isAnonymousLike: !canSeeWhoLikedYou,
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

    private async recordPassSwipe(userId: string, targetUserId: string): Promise<Record<string, unknown>> {
        const passSeenCacheKey = this.buildPassSeenCacheKey(userId, targetUserId);
        const knownPass = await this.redisService.get(passSeenCacheKey).catch(() => null);

        if (!knownPass) {
            void this.redisService.set(passSeenCacheKey, '1', 24 * 60 * 60).catch(() => undefined);

            void this.likeRepository
                .insert({
                    likerId: userId,
                    likedId: targetUserId,
                    type: LikeType.PASS,
                    isLike: false,
                    complimentMessage: '',
                })
                .catch((error) => {
                    if (this.isUniqueConstraintViolation(error)) {
                        return;
                    }

                    void this.redisService.del(passSeenCacheKey).catch(() => undefined);
                    this.logger.warn(
                        `Failed to persist pass swipe ${userId}->${targetUserId}: ${
                            (error as any)?.message ?? error
                        }`,
                    );
                });

            return { liked: false, matched: false, action: SwipeAction.PASS };
        }

        try {
            await this.likeRepository.insert({
                likerId: userId,
                likedId: targetUserId,
                type: LikeType.PASS,
                isLike: false,
                complimentMessage: '',
            });

            await this.redisService.set(passSeenCacheKey, '1', 24 * 60 * 60).catch(() => undefined);

            return { liked: false, matched: false, action: SwipeAction.PASS };
        } catch (error) {
            if (!this.isUniqueConstraintViolation(error)) {
                throw error;
            }

            const existingSwipe = await this.likeRepository.findOne({
                where: { likerId: userId, likedId: targetUserId },
            });

            if (!existingSwipe) {
                await this.redisService.del(passSeenCacheKey).catch(() => undefined);
                return { liked: false, matched: false, action: SwipeAction.PASS };
            }

            if (!existingSwipe.isLike) {
                // Refresh pass recency so rewind always targets the last pass gesture.
                await this.likeRepository.delete({ id: existingSwipe.id });

                await this.likeRepository.insert({
                    likerId: userId,
                    likedId: targetUserId,
                    type: LikeType.PASS,
                    isLike: false,
                    complimentMessage: '',
                });

                await this.redisService.set(passSeenCacheKey, '1', 24 * 60 * 60).catch(() => undefined);

                return {
                    liked: false,
                    matched: false,
                    action: SwipeAction.PASS,
                    refreshedPass: true,
                };
            }

            void this.redisService.del(passSeenCacheKey).catch(() => undefined);
            const existingActiveMatch = await this.findActiveMatch(userId, targetUserId);
            return {
                liked: existingSwipe.isLike,
                matched: !!existingActiveMatch,
                matchId: existingActiveMatch?.id ?? null,
                action: existingSwipe.type,
                duplicate: true,
            };
        }
    }

    private scheduleDiscoveryCacheInvalidation(...userIds: string[]): void {
        void this.invalidateDiscoveryCaches(...userIds).catch((error) => {
            this.logger.warn(
                `Failed to invalidate discovery cache: ${error?.message ?? error}`,
            );
        });
    }

    private async invalidateDiscoveryCaches(...userIds: string[]): Promise<void> {
        const uniqueIds = [
            ...new Set(userIds.map((id) => id?.trim()).filter((id): id is string => !!id)),
        ];
        if (uniqueIds.length === 0) return;

        await Promise.all(
            uniqueIds.flatMap((id) => [
                this.redisService.del(`excludeIds:${id}`),
                this.redisService.del(`interaction_exclusions:${id}`),
                this.redisService.del(`discovery:${id}`),
                this.redisService.del(`suggestions:${id}`),
                this.redisService.del(`matches:${id}`),
                this.redisService.del(`conversations:${id}`),
                this.redisService.delByPattern(`search:${id}:*`),
            ]),
        );
    }

    private async findActiveMatch(userA: string, userB: string): Promise<Match | null> {
        const [first, second] = [userA, userB].sort();
        return this.matchRepository.findOne({
            where: {
                user1Id: first,
                user2Id: second,
                status: MatchStatus.ACTIVE,
            },
        });
    }

    private async getMatchedUserIdsSet(userId: string): Promise<Set<string>> {
        const matches = await this.matchRepository.find({
            where: [
                { user1Id: userId, status: MatchStatus.ACTIVE },
                { user2Id: userId, status: MatchStatus.ACTIVE },
            ],
            select: {
                user1Id: true,
                user2Id: true,
            },
        });

        const ids = new Set<string>();
        for (const match of matches) {
            ids.add(match.user1Id === userId ? match.user2Id : match.user1Id);
        }
        return ids;
    }

    private isUniqueConstraintViolation(error: unknown): boolean {
        const code = (error as any)?.code ?? (error as any)?.driverError?.code;
        return code === '23505';
    }

    private buildPassSeenCacheKey(userId: string, targetUserId: string): string {
        return `swipe_pass_seen:${userId}:${targetUserId}`;
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



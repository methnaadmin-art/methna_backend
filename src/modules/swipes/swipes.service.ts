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
import { CreateSwipeDto, SwipeAction } from './dto/swipe.dto';
import { RedisService } from '../redis/redis.service';
import { NotificationsService } from '../notifications/notifications.service';

const FREE_DAILY_SWIPE_LIMIT = 25;
const FREE_DAILY_SUPER_LIKE_LIMIT = 1;

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
        private readonly redisService: RedisService,
        private readonly notificationsService: NotificationsService,
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
        const subscription = await this.subscriptionRepository.findOne({
            where: { userId, status: 'active' as any },
        });
        return !!subscription && subscription.plan !== SubscriptionPlan.FREE;
    }
}

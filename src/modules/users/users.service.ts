import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
    User,
    UserStatus,
    normalizeVerificationState,
} from '../../database/entities/user.entity';
import { Profile } from '../../database/entities/profile.entity';
import { Photo, PhotoModerationStatus } from '../../database/entities/photo.entity';
import { Like, LikeType } from '../../database/entities/like.entity';
import { Boost } from '../../database/entities/boost.entity';
import { Match, MatchStatus } from '../../database/entities/match.entity';
import { Conversation } from '../../database/entities/conversation.entity';
import { Message, MessageType } from '../../database/entities/message.entity';
import { RematchRequest, RematchStatus } from '../../database/entities/rematch-request.entity';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class UsersService {
    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(Profile)
        private readonly profileRepository: Repository<Profile>,
        @InjectRepository(Photo)
        private readonly photoRepository: Repository<Photo>,
        @InjectRepository(Like)
        private readonly likeRepository: Repository<Like>,
        @InjectRepository(Boost)
        private readonly boostRepository: Repository<Boost>,
        @InjectRepository(Match)
        private readonly matchRepository: Repository<Match>,
        @InjectRepository(Conversation)
        private readonly conversationRepository: Repository<Conversation>,
        @InjectRepository(Message)
        private readonly messageRepository: Repository<Message>,
        @InjectRepository(RematchRequest)
        private readonly rematchRepository: Repository<RematchRequest>,
        private readonly redisService: RedisService,
    ) { }

    private static readonly SAFE_USER_SELECT = {
        id: true,
        username: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        status: true,
        statusReason: true,
        isPremium: true,
        premiumStartDate: true,
        premiumExpiryDate: true,
        verification: true,
        emailVerified: true,
        selfieVerified: true,
        selfieUrl: true,
        documentUrl: true,
        documentType: true,
        documentVerified: true,
        documentVerifiedAt: true,
        documentRejectionReason: true,
        fcmToken: true,
        notificationsEnabled: true,
        matchNotifications: true,
        messageNotifications: true,
        likeNotifications: true,
        profileVisitorNotifications: true,
        eventsNotifications: true,
        safetyAlertNotifications: true,
        promotionsNotifications: true,
        inAppRecommendationNotifications: true,
        weeklySummaryNotifications: true,
        connectionRequestNotifications: true,
        surveyNotifications: true,
        readReceipts: true,
        typingIndicator: true,
        autoDownloadMedia: true,
        receiveDMs: true,
        locationEnabled: true,
        boostedUntil: true,
        isShadowBanned: true,
        trustScore: true,
        moderationReasonCode: true,
        moderationReasonText: true,
        actionRequired: true,
        supportMessage: true,
        isUserVisible: true,
        moderationExpiresAt: true,
        internalAdminNote: true,
        updatedByAdminId: true,
        flagCount: true,
        lastKnownIp: true,
        deviceCount: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
    } as const;

    private static readonly SAFE_USER_SELECT_WITHOUT_PREMIUM = (() => {
        const {
            isPremium,
            premiumStartDate,
            premiumExpiryDate,
            ...safeSelectWithoutPremium
        } = UsersService.SAFE_USER_SELECT;

        return safeSelectWithoutPremium;
    })();

    private static readonly SAFE_USER_SELECT_LEGACY = (() => {
        const {
            isPremium,
            premiumStartDate,
            premiumExpiryDate,
            verification,
            ...safeSelectLegacy
        } = UsersService.SAFE_USER_SELECT;

        return safeSelectLegacy;
    })();

    async findById(id: string): Promise<User> {
        const user = await this.findUserWithSafeSelect({ id });
        if (!user) throw new NotFoundException('User not found');
        return this.normalizeUserState(user);
    }

    async findByEmail(email: string): Promise<User> {
        const user = await this.findUserWithSafeSelect({ email });
        if (!user) throw new NotFoundException('User not found');
        return this.normalizeUserState(user);
    }

    async getMe(userId: string) {
        const user = await this.findById(userId);

        // Load profile + photos + stats
        const [profile, photos, sentComplimentsCount, profileBoostsCount] = await Promise.all([
            this.profileRepository.findOne({ where: { userId } }),
            this.photoRepository.find({
                where: { userId },
                order: { isMain: 'DESC', order: 'ASC' },
            }),
            this.likeRepository.count({
                where: { likerId: userId, type: LikeType.COMPLIMENT },
            }),
            this.boostRepository.count({
                where: { userId },
            }),
        ]);

        return {
            ...this.normalizeUserState(user),
            profile: profile || null,
            photos: photos || [],
            sentComplimentsCount,
            profileBoostsCount,
        };
    }

    // Fields a user is allowed to modify on their own account
    private static readonly ALLOWED_UPDATE_FIELDS = new Set([
        'firstName', 'lastName', 'phone', 'username',
        'notificationsEnabled', 'matchNotifications',
        'messageNotifications', 'likeNotifications',
        'profileVisitorNotifications', 'eventsNotifications',
        'safetyAlertNotifications', 'promotionsNotifications',
        'inAppRecommendationNotifications', 'weeklySummaryNotifications',
        'connectionRequestNotifications', 'surveyNotifications',
        'readReceipts', 'typingIndicator', 'autoDownloadMedia', 'receiveDMs',
        'locationEnabled',
    ]);

    async updateMe(
        userId: string,
        updateData: Partial<User>,
    ): Promise<User> {
        // Strip any fields the user is not allowed to set (prevents privilege escalation)
        const safeData: Record<string, any> = {};
        for (const [key, value] of Object.entries(updateData)) {
            if (UsersService.ALLOWED_UPDATE_FIELDS.has(key)) {
                safeData[key] = key === 'username' && typeof value === 'string'
                    ? value.trim().toLowerCase()
                    : value;
            }
        }

        if (updateData.status !== undefined) {
            if (updateData.status !== UserStatus.DEACTIVATED) {
                throw new BadRequestException('Invalid status update');
            }
            safeData.status = UserStatus.DEACTIVATED;
        }

        if (safeData.username !== undefined) {
            if (!safeData.username) {
                throw new BadRequestException('Username cannot be empty');
            }

            const existingUser = await this.userRepository.findOne({
                where: { username: safeData.username },
                select: {
                    id: true,
                },
            });
            if (existingUser && existingUser.id !== userId) {
                throw new ConflictException('Username already taken');
            }
        }

        if (Object.keys(safeData).length > 0) {
            await this.userRepository.update(userId, safeData);
        }
        return this.findById(userId);
    }

    async softDelete(userId: string): Promise<void> {
        await this.userRepository.softDelete(userId);
    }

    /**
     * User-initiated account closure.
     * Sets status to CLOSED, then deactivates all presence:
     * matches, conversations, likes, rematch requests, caches.
     */
    async closeAccount(userId: string): Promise<{ status: string }> {
        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');
        if (user.status === UserStatus.CLOSED) {
            throw new BadRequestException('Account is already closed');
        }

        // 1. Set user status to CLOSED
        await this.userRepository.update(userId, {
            status: UserStatus.CLOSED,
            statusReason: 'User initiated account closure',
        });

        const lockReason = 'This user has closed their account.';

        // 2. Close all active matches
        const activeMatches = await this.matchRepository.find({
            where: [
                { user1Id: userId, status: MatchStatus.ACTIVE },
                { user2Id: userId, status: MatchStatus.ACTIVE },
            ],
        });
        if (activeMatches.length > 0) {
            for (const match of activeMatches) {
                match.status = MatchStatus.CLOSED;
            }
            await this.matchRepository.save(activeMatches);
        }

        // 3. Lock all active conversations + insert system message
        const activeConversations = await this.conversationRepository.find({
            where: [
                { user1Id: userId, isActive: true },
                { user2Id: userId, isActive: true },
            ],
        });
        for (const conv of activeConversations) {
            conv.isActive = false;
            conv.isLocked = true;
            conv.lockReason = lockReason;
            await this.conversationRepository.save(conv);

            const systemMsg = this.messageRepository.create({
                conversationId: conv.id,
                matchId: conv.matchId,
                senderId: userId,
                content: lockReason,
                type: MessageType.SYSTEM,
            });
            await this.messageRepository.save(systemMsg);
        }

        // 4. Remove likes FROM this user
        await this.likeRepository.delete({ likerId: userId, isLike: true });

        // 5. Convert likes RECEIVED by this user to passes (no longer actionable)
        await this.likeRepository.update(
            { likedId: userId, isLike: true },
            { isLike: false, type: LikeType.PASS },
        );

        // 6. Cancel pending rematch requests
        await this.rematchRepository.update(
            { requesterId: userId, status: RematchStatus.PENDING },
            { status: RematchStatus.EXPIRED },
        );
        await this.rematchRepository.update(
            { targetId: userId, status: RematchStatus.PENDING },
            { status: RematchStatus.EXPIRED },
        );

        // 7. Invalidate caches for the user and all affected matched users
        const affectedUserIds = new Set<string>([userId]);
        for (const match of activeMatches) {
            affectedUserIds.add(match.user1Id === userId ? match.user2Id : match.user1Id);
        }
        for (const conv of activeConversations) {
            affectedUserIds.add(conv.user1Id === userId ? conv.user2Id : conv.user1Id);
        }

        await Promise.all([...affectedUserIds].flatMap(id => [
            this.redisService.del(`excludeIds:${id}`),
            this.redisService.del(`discovery:${id}`),
            this.redisService.del(`suggestions:${id}`),
            this.redisService.del(`matches:${id}`),
            this.redisService.del(`conversations:${id}`),
            this.redisService.del(`premium:${id}`),
            this.redisService.del(`user_status:${id}`),
        ]));

        // 8. Invalidate all user sessions so they are logged out
        await this.redisService.invalidateAllUserSessions(userId);

        return { status: 'closed' };
    }

    async getPublicProfile(userId: string): Promise<Partial<User>> {
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                role: true,
                status: true,
                selfieVerified: true,
                createdAt: true,
            },
            relations: ['profile'],
        });
        if (!user) throw new NotFoundException('User not found');

        // Hide banned/closed/deactivated profiles from public view
        const hiddenStatuses = [UserStatus.BANNED, UserStatus.CLOSED, UserStatus.DEACTIVATED];
        if (hiddenStatuses.includes(user.status as UserStatus)) {
            throw new NotFoundException('This user is no longer available.');
        }

        // Only return approved photos to other users
        const photos = await this.photoRepository.find({
            where: { userId, moderationStatus: PhotoModerationStatus.APPROVED },
            order: { isMain: 'DESC', order: 'ASC' },
        });

        // Explicit whitelist — never expose sensitive fields to other users
        return {
            id: user.id,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            selfieVerified: user.selfieVerified,
            createdAt: user.createdAt,
            profile: user.profile,
            photos: photos || [],
        } as Partial<User>;
    }

    async updateStatus(userId: string, status: UserStatus): Promise<void> {
        await this.userRepository.update(userId, { status });
    }

    async getModerationStatus(userId: string): Promise<{
        status: UserStatus;
        reason: string | null;
        isLimited: boolean;
        isSuspended: boolean;
        isBanned: boolean;
        isShadowSuspended: boolean;
        moderationReasonCode: string | null;
        moderationReasonText: string | null;
        actionRequired: string | null;
        supportMessage: string | null;
        isUserVisible: boolean;
        expiresAt: string | null;
    }> {
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: [
                'id', 'status', 'statusReason',
                'moderationReasonCode', 'moderationReasonText',
                'actionRequired', 'supportMessage',
                'isUserVisible', 'moderationExpiresAt',
            ],
        });
        if (!user) {
            return {
                status: UserStatus.BANNED,
                reason: 'User not found',
                isLimited: false,
                isSuspended: false,
                isBanned: true,
                isShadowSuspended: false,
                moderationReasonCode: null,
                moderationReasonText: null,
                actionRequired: null,
                supportMessage: null,
                isUserVisible: true,
                expiresAt: null,
            };
        }

        // Check if moderation has expired — auto-revert to ACTIVE
        if (
            user.moderationExpiresAt &&
            new Date() > user.moderationExpiresAt &&
            user.status !== UserStatus.ACTIVE &&
            user.status !== UserStatus.BANNED
        ) {
            await this.userRepository.update(userId, {
                status: UserStatus.ACTIVE,
                statusReason: null,
                moderationReasonCode: null,
                moderationReasonText: null,
                actionRequired: null,
                supportMessage: null,
                moderationExpiresAt: null,
            });
            return {
                status: UserStatus.ACTIVE,
                reason: null,
                isLimited: false,
                isSuspended: false,
                isBanned: false,
                isShadowSuspended: false,
                moderationReasonCode: null,
                moderationReasonText: null,
                actionRequired: null,
                supportMessage: null,
                isUserVisible: true,
                expiresAt: null,
            };
        }

        return {
            status: user.status,
            reason: user.statusReason,
            isLimited: user.status === UserStatus.LIMITED,
            isSuspended: user.status === UserStatus.SUSPENDED,
            isBanned: user.status === UserStatus.BANNED,
            isShadowSuspended: user.status === UserStatus.SHADOW_SUSPENDED,
            moderationReasonCode: user.moderationReasonCode,
            moderationReasonText: user.moderationReasonText,
            actionRequired: user.actionRequired,
            supportMessage: user.supportMessage,
            isUserVisible: user.isUserVisible,
            expiresAt: user.moderationExpiresAt?.toISOString() || null,
        };
    }

    async findAll(page: number, limit: number) {
        const [users, total] = await this.userRepository.findAndCount({
            skip: (page - 1) * limit,
            take: limit,
            relations: ['profile', 'photos'],
            order: { createdAt: 'DESC' },
        });
        return { users, total, page, limit };
    }

    async isUsernameAvailable(username: string): Promise<boolean> {
        const user = await this.userRepository.findOne({
            where: { username: username.toLowerCase() },
            select: {
                id: true,
                username: true,
                status: true,
                emailVerified: true,
            },
        });
        if (!user) return true;
        // Username held by an unverified user is considered available
        if (user.status === UserStatus.PENDING_VERIFICATION && !user.emailVerified) {
            return true;
        }
        return false;
    }

    private normalizeUserState(user: User): User {
        return {
            ...user,
            isPremium: user.isPremium ?? false,
            premiumStartDate: user.premiumStartDate ?? null,
            premiumExpiryDate: user.premiumExpiryDate ?? null,
            verification: normalizeVerificationState(user.verification),
        };
    }

    private async findUserWithSafeSelect(where: { id: string } | { email: string }): Promise<User | null> {
        try {
            return await this.userRepository.findOne({
                where,
                select: UsersService.SAFE_USER_SELECT,
            });
        } catch (error: any) {
            if (!this.isMissingUserCompatibilityColumnsError(error)) {
                throw error;
            }

            return this.userRepository.findOne({
                where,
                select: UsersService.SAFE_USER_SELECT_LEGACY,
            });
        }
    }

    private isMissingUserCompatibilityColumnsError(error: unknown): boolean {
        if (!error || typeof error !== 'object') {
            return false;
        }

        const message = String((error as { message?: unknown }).message ?? '');
        if (!message.toLowerCase().includes('does not exist')) {
            return false;
        }

        return this.isMissingPremiumColumnsError(error) || this.isMissingVerificationColumnError(error);
    }

    private isMissingPremiumColumnsError(error: unknown): boolean {
        const message = String((error as { message?: unknown })?.message ?? '');
        return (
            message.includes('isPremium') ||
            message.includes('premiumStartDate') ||
            message.includes('premiumExpiryDate')
        );
    }

    private isMissingVerificationColumnError(error: unknown): boolean {
        const message = String((error as { message?: unknown })?.message ?? '');
        return message.includes('verification');
    }
}

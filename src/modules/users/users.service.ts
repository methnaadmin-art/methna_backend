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
    VerificationStatus,
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
import { CloudinaryService } from '../photos/cloudinary.service';

type AccountClosureAction = 'deactivate' | 'delete';

type CloseAccountPayload = {
    action?: AccountClosureAction;
    reason?: string;
    details?: string;
    hardDelete?: boolean;
};

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
        subscriptionPlanId: true,
        isGhostModeEnabled: true,
        isPassportActive: true,
        realLocation: true,
        passportLocation: true,
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
            subscriptionPlanId,
            isGhostModeEnabled,
            isPassportActive,
            realLocation,
            passportLocation,
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
            await this.closeAccount(userId, { action: 'deactivate' });
            return this.findById(userId);
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

    private buildUserInitiatedReason(baseReason: string, payload?: CloseAccountPayload): string {
        const reason = payload?.reason?.trim();
        const details = payload?.details?.trim();

        if (!reason && !details) {
            return baseReason;
        }

        const segments = [baseReason];
        if (reason) {
            segments.push(`Reason: ${reason}`);
        }
        if (details) {
            segments.push(`Details: ${details}`);
        }

        return segments.join(' | ');
    }

    private async invalidateAccountCaches(affectedUserIds: Set<string>): Promise<void> {
        await Promise.all(
            [...affectedUserIds].flatMap((id) => [
                this.redisService.del(`excludeIds:${id}`),
                this.redisService.del(`discovery:${id}`),
                this.redisService.del(`suggestions:${id}`),
                this.redisService.del(`matches:${id}`),
                this.redisService.del(`conversations:${id}`),
                this.redisService.del(`premium:${id}`),
                this.redisService.del(`user_status:${id}`),
            ]),
        );
    }

    /**
     * User-initiated account closure.
     * `action=deactivate` keeps user data and hides account until next login.
     * `action=delete` (default) performs full closure and presence teardown.
     */
    async closeAccount(userId: string, payload?: CloseAccountPayload): Promise<{ status: string }> {
        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        const action: AccountClosureAction = payload?.action === 'deactivate' ? 'deactivate' : 'delete';

        if (action === 'deactivate') {
            if (user.status === UserStatus.DEACTIVATED) {
                return { status: 'deactivated' };
            }
            if (user.status === UserStatus.CLOSED) {
                throw new BadRequestException('Account is already closed');
            }

            await this.userRepository.update(userId, {
                status: UserStatus.DEACTIVATED,
                statusReason: this.buildUserInitiatedReason(
                    'User temporarily deactivated account',
                    payload,
                ),
                supportMessage: null,
                moderationReasonCode: null,
                moderationReasonText: null,
                actionRequired: null,
                internalAdminNote: null,
                moderationExpiresAt: null,
                isUserVisible: false,
                updatedByAdminId: null,
            });

            const activeMatches = await this.matchRepository.find({
                where: [
                    { user1Id: userId, status: MatchStatus.ACTIVE },
                    { user2Id: userId, status: MatchStatus.ACTIVE },
                ],
            });
            const activeConversations = await this.conversationRepository.find({
                where: [
                    { user1Id: userId, isActive: true },
                    { user2Id: userId, isActive: true },
                ],
            });

            const affectedUserIds = new Set<string>([userId]);
            for (const match of activeMatches) {
                affectedUserIds.add(match.user1Id === userId ? match.user2Id : match.user1Id);
            }
            for (const conv of activeConversations) {
                affectedUserIds.add(conv.user1Id === userId ? conv.user2Id : conv.user1Id);
            }

            await this.invalidateAccountCaches(affectedUserIds);
            await this.redisService.invalidateAllUserSessions(userId);

            return { status: 'deactivated' };
        }

        if (user.status === UserStatus.CLOSED) {
            throw new BadRequestException('Account is already closed');
        }

        // 1. Set user status to CLOSED
        await this.userRepository.update(userId, {
            status: UserStatus.CLOSED,
            statusReason: this.buildUserInitiatedReason('User initiated account closure', payload),
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

        await this.invalidateAccountCaches(affectedUserIds);

        // 8. Invalidate all user sessions so they are logged out
        await this.redisService.invalidateAllUserSessions(userId);

        return { status: 'closed' };
    }

    async getPublicProfile(
        userId: string,
        viewerId?: string,
    ): Promise<Partial<User>> {
        let user: User | null;
        try {
            user = await this.userRepository.findOne({
                where: { id: userId },
                select: {
                    id: true,
                    username: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                    status: true,
                    selfieVerified: true,
                    isPremium: true,
                    premiumStartDate: true,
                    premiumExpiryDate: true,
                    isGhostModeEnabled: true,
                    isPassportActive: true,
                    passportLocation: true,
                    createdAt: true,
                },
                relations: ['profile'],
            });
        } catch (error) {
            if (!this.isMissingPremiumColumnsError(error)) {
                throw error;
            }

            user = await this.userRepository.findOne({
                where: { id: userId },
                select: {
                    id: true,
                    username: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                    status: true,
                    selfieVerified: true,
                    isGhostModeEnabled: true,
                    isPassportActive: true,
                    passportLocation: true,
                    createdAt: true,
                },
                relations: ['profile'],
            } as any);
        }
        if (!user) throw new NotFoundException('User not found');

        let viewerSelfieVerified = false;
        if (viewerId && viewerId !== userId) {
            try {
                const viewer = await this.userRepository.findOne({
                    where: { id: viewerId },
                    select: {
                        id: true,
                        selfieVerified: true,
                    },
                });

                viewerSelfieVerified = viewer?.selfieVerified === true;
            } catch {
                // Backward compatibility for databases missing premium columns.
                const viewer = await this.userRepository.findOne({
                    where: { id: viewerId },
                    select: {
                        id: true,
                        selfieVerified: true,
                    },
                } as any);
                viewerSelfieVerified = viewer?.selfieVerified === true;
            }
        }

        const shouldRestrictGallery =
            !!viewerId &&
            viewerId !== userId &&
            !viewerSelfieVerified;
        const shouldMaskGhostProfile =
            !!viewerId &&
            viewerId !== userId &&
            user.isGhostModeEnabled === true;
        const canViewAllPhotos = !shouldRestrictGallery;
        const targetHasActivePremium = this.hasActivePremiumEntitlement(user);

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
        const serializedPhotos = this.applyViewerPhotoAccessPolicy(
            photos || [],
            userId,
            shouldRestrictGallery,
        );

        const effectiveLocation = this.resolveEffectiveLocation(
            user,
            user.profile ?? null,
        );

        const profilePayload: Record<string, any> | null = user.profile
            ? {
                ...user.profile,
                city: effectiveLocation.city,
                country: effectiveLocation.country,
                latitude: effectiveLocation.latitude,
                longitude: effectiveLocation.longitude,
            }
            : null;

        const publicFirstName = shouldMaskGhostProfile ? 'Ghost' : user.firstName;
        const publicLastName = shouldMaskGhostProfile ? 'Member' : user.lastName;
        const publicUsername = shouldMaskGhostProfile ? null : user.username;
        const publicPhotos = shouldMaskGhostProfile
            ? this.applyGhostPhotoMask(serializedPhotos, userId)
            : serializedPhotos;

        if (shouldMaskGhostProfile && profilePayload) {
            profilePayload.bio = null;
            profilePayload.aboutPartner = null;
            profilePayload.jobTitle = null;
            profilePayload.company = null;
        }

        // Explicit whitelist — never expose sensitive fields to other users
        return {
            id: user.id,
            username: publicUsername,
            firstName: publicFirstName,
            lastName: publicLastName,
            role: user.role,
            selfieVerified: user.selfieVerified,
            isPremium: targetHasActivePremium,
            premiumStartDate: user.premiumStartDate ?? null,
            premiumExpiryDate: user.premiumExpiryDate ?? null,
            subscriptionPlanId: user.subscriptionPlanId ?? null,
            isGhostModeEnabled: user.isGhostModeEnabled === true,
            isPassportActive: effectiveLocation.isPassportActive,
            canViewAllPhotos,
            createdAt: user.createdAt,
            profile: profilePayload,
            photos: publicPhotos,
        } as unknown as Partial<User>;
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
        const hasActivePremium = this.hasActivePremiumEntitlement(user);
        const verification = this.reconcileVerificationState(user);

        return {
            ...user,
            isPremium: hasActivePremium,
            premiumStartDate: user.premiumStartDate ?? null,
            premiumExpiryDate: user.premiumExpiryDate ?? null,
            verification,
        };
    }

    private reconcileVerificationState(user: User) {
        const verification = normalizeVerificationState(user.verification);
        const selfieUrl = (user.selfieUrl || verification.selfie.url || null) as string | null;

        if (user.selfieVerified === true) {
            verification.selfie = {
                ...verification.selfie,
                status: VerificationStatus.APPROVED,
                url: selfieUrl,
                rejectionReason: null,
            };
        } else if (verification.selfie.status === VerificationStatus.REJECTED) {
            verification.selfie = {
                ...verification.selfie,
                url: selfieUrl,
            };
        } else if (selfieUrl) {
            verification.selfie = {
                ...verification.selfie,
                status: VerificationStatus.PENDING,
                url: selfieUrl,
            };
        } else {
            verification.selfie = {
                ...verification.selfie,
                status: VerificationStatus.NOT_SUBMITTED,
                url: null,
                rejectionReason: null,
                submittedAt: null,
                reviewedAt: null,
                reviewedBy: null,
            };
        }

        const maritalUrl = (verification.marital_status.url || null) as string | null;
        if (verification.marital_status.status === VerificationStatus.REJECTED) {
            verification.marital_status = {
                ...verification.marital_status,
                url: maritalUrl,
            };
        } else if (verification.marital_status.status === VerificationStatus.APPROVED) {
            verification.marital_status = {
                ...verification.marital_status,
                url: maritalUrl,
                rejectionReason: null,
            };
        } else if (maritalUrl) {
            verification.marital_status = {
                ...verification.marital_status,
                status: VerificationStatus.PENDING,
                url: maritalUrl,
            };
        } else {
            verification.marital_status = {
                ...verification.marital_status,
                status: VerificationStatus.NOT_SUBMITTED,
                url: null,
                rejectionReason: null,
                submittedAt: null,
                reviewedAt: null,
                reviewedBy: null,
            };
        }

        return verification;
    }

    private hasActivePremiumEntitlement(
        user:
            | Pick<User, 'isPremium' | 'premiumStartDate' | 'premiumExpiryDate'>
            | null
            | undefined,
    ): boolean {
        if (!user || user.isPremium !== true) {
            return false;
        }

        const now = Date.now();
        const premiumStartDate = user.premiumStartDate
            ? new Date(user.premiumStartDate).getTime()
            : null;
        const premiumExpiryDate = user.premiumExpiryDate
            ? new Date(user.premiumExpiryDate).getTime()
            : null;

        if (premiumStartDate !== null && Number.isFinite(premiumStartDate) && premiumStartDate > now) {
            return false;
        }

        if (premiumExpiryDate !== null && Number.isFinite(premiumExpiryDate) && premiumExpiryDate <= now) {
            return false;
        }

        return true;
    }

    private applyViewerPhotoAccessPolicy(
        photos: Photo[],
        targetUserId: string,
        restrictGallery: boolean,
    ): Array<Record<string, unknown>> {
        if (!Array.isArray(photos) || photos.length === 0) {
            return [];
        }

        const serializePhoto = (photo: Photo, isLocked = false) => ({
            ...(isLocked ? {} : CloudinaryService.buildImageUrls(photo.url)),
            id: photo.id,
            url: isLocked ? '' : CloudinaryService.profileUrl(photo.url),
            mediumUrl: isLocked ? '' : CloudinaryService.cardUrl(photo.url),
            publicId: isLocked ? null : photo.publicId,
            isMain: photo.isMain,
            isSelfieVerification: photo.isSelfieVerification,
            order: photo.order,
            moderationStatus: isLocked ? 'locked' : photo.moderationStatus,
            moderationNote: isLocked ? null : photo.moderationNote,
            createdAt: photo.createdAt,
            isLocked,
            lockReason: isLocked
                ? 'Verify your selfie to unlock all photos'
                : null,
            unlockCta: isLocked
                ? 'Verify selfie now'
                : null,
        });

        if (!restrictGallery) {
            return photos.map((photo) => serializePhoto(photo, false));
        }

        const mainPhoto = photos.find((photo) => photo.isMain) ?? photos[0];
        if (!mainPhoto) {
            return [];
        }

        const visible = [serializePhoto(mainPhoto, false)];
        const lockedCount = Math.max(photos.length - 1, 0);

        for (let index = 0; index < lockedCount; index += 1) {
            visible.push({
                id: `${targetUserId}-locked-${index + 1}`,
                url: '',
                originalUrl: '',
                thumbnailUrl: '',
                mediumUrl: '',
                cardUrl: '',
                profileUrl: '',
                fullscreenUrl: '',
                publicId: null,
                isMain: false,
                isSelfieVerification: false,
                order: (mainPhoto.order ?? 0) + index + 1,
                moderationStatus: 'locked',
                moderationNote: null,
                createdAt: mainPhoto.createdAt,
                isLocked: true,
                lockReason: 'Verify your selfie to unlock all photos',
                unlockCta: 'Verify selfie now',
            });
        }

        return visible;
    }

    private applyGhostPhotoMask(
        photos: Array<Record<string, unknown>>,
        targetUserId: string,
    ): Array<Record<string, unknown>> {
        if (!Array.isArray(photos) || photos.length === 0) {
            return [
                {
                    id: `${targetUserId}-ghost-1`,
                    url: '',
                    originalUrl: '',
                    thumbnailUrl: '',
                    mediumUrl: '',
                    cardUrl: '',
                    profileUrl: '',
                    fullscreenUrl: '',
                    publicId: null,
                    isMain: true,
                    isSelfieVerification: false,
                    order: 1,
                    moderationStatus: 'ghost_masked',
                    moderationNote: null,
                    createdAt: null,
                    isLocked: true,
                    lockReason: 'This member is using Ghost Mode',
                    unlockCta: 'Ghost mode keeps identity private until mutual trust is built',
                },
            ];
        }

        return photos.map((photo, index) => ({
            ...photo,
            id: photo['id'] ?? `${targetUserId}-ghost-${index + 1}`,
            url: '',
            originalUrl: '',
            thumbnailUrl: '',
            mediumUrl: '',
            cardUrl: '',
            profileUrl: '',
            fullscreenUrl: '',
            publicId: null,
            isLocked: true,
            lockReason: 'This member is using Ghost Mode',
            unlockCta: 'Ghost mode keeps identity private until mutual trust is built',
        }));
    }

    private resolveEffectiveLocation(
        user: Pick<User, 'isPassportActive' | 'passportLocation'>,
        profile: Profile | null,
    ): {
        city: string | null;
        country: string | null;
        latitude: number | null;
        longitude: number | null;
        isPassportActive: boolean;
    } {
        const passportLocation = user.passportLocation;
        const hasPassportLocation =
            user.isPassportActive === true &&
            !!passportLocation &&
            typeof passportLocation === 'object';

        if (hasPassportLocation) {
            return {
                city: (passportLocation?.city as string | undefined) ?? null,
                country: (passportLocation?.country as string | undefined) ?? null,
                latitude: Number.isFinite(passportLocation?.latitude as number)
                    ? (passportLocation?.latitude as number)
                    : null,
                longitude: Number.isFinite(passportLocation?.longitude as number)
                    ? (passportLocation?.longitude as number)
                    : null,
                isPassportActive: true,
            };
        }

        return {
            city: profile?.city ?? null,
            country: profile?.country ?? null,
            latitude: profile?.latitude ?? null,
            longitude: profile?.longitude ?? null,
            isPassportActive: false,
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

        return (
            this.isMissingPremiumColumnsError(error) ||
            this.isMissingVerificationColumnError(error) ||
            this.isMissingVisibilityColumnsError(error)
        );
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

    private isMissingVisibilityColumnsError(error: unknown): boolean {
        const message = String((error as { message?: unknown })?.message ?? '');
        return (
            message.includes('subscriptionPlanId') ||
            message.includes('isGhostModeEnabled') ||
            message.includes('isPassportActive') ||
            message.includes('realLocation') ||
            message.includes('passportLocation')
        );
    }
}

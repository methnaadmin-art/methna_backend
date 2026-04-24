import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not } from 'typeorm';
import { Match, MatchStatus } from '../../database/entities/match.entity';
import { Like } from '../../database/entities/like.entity';
import { Profile } from '../../database/entities/profile.entity';
import { UserPreference } from '../../database/entities/user-preference.entity';
import { BlockedUser } from '../../database/entities/blocked-user.entity';
import { Photo } from '../../database/entities/photo.entity';
import { User, UserStatus } from '../../database/entities/user.entity';
import { Conversation } from '../../database/entities/conversation.entity';
import { RedisService } from '../redis/redis.service';
import { CloudinaryService } from '../photos/cloudinary.service';
import { PaginationDto } from '../../common/dto/pagination.dto';

@Injectable()
export class MatchesService {
    private readonly logger = new Logger(MatchesService.name);

    constructor(
        @InjectRepository(Match)
        private readonly matchRepository: Repository<Match>,
        @InjectRepository(Like)
        private readonly likeRepository: Repository<Like>,
        @InjectRepository(Profile)
        private readonly profileRepository: Repository<Profile>,
        @InjectRepository(UserPreference)
        private readonly preferenceRepository: Repository<UserPreference>,
        @InjectRepository(BlockedUser)
        private readonly blockedUserRepository: Repository<BlockedUser>,
        @InjectRepository(Photo)
        private readonly photoRepository: Repository<Photo>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(Conversation)
        private readonly conversationRepository: Repository<Conversation>,
        private readonly redisService: RedisService,
    ) { }

    async getMatches(userId: string, pagination: PaginationDto) {
        const [matches, total] = await this.matchRepository.findAndCount({
            where: [
                { user1Id: userId, status: MatchStatus.ACTIVE },
                { user2Id: userId, status: MatchStatus.ACTIVE },
            ],
            relations: ['user1', 'user2'],
            order: { matchedAt: 'DESC' },
            skip: pagination.skip,
            take: pagination.limit,
        });

        // Batch fetch photos for all matched users (avoids N+1)
        const otherUserIds = matches.map(m => m.user1Id === userId ? m.user2Id : m.user1Id);
        const photos = otherUserIds.length > 0
            ? await this.photoRepository
                .createQueryBuilder('photo')
                .where('photo.userId IN (:...otherUserIds)', { otherUserIds })
                .andWhere('photo.isMain = :isMain', { isMain: true })
                .andWhere('photo.moderationStatus = :approvedStatus', { approvedStatus: 'approved' })
                .getMany()
            : [];
        const photoMap = new Map(
            photos.map((photo) => {
                const variants = CloudinaryService.buildImageUrls(photo.url);
                return [
                    photo.userId,
                    {
                        thumbnailUrl: variants.thumbnailUrl,
                        mediumUrl: variants.cardUrl,
                        cardUrl: variants.cardUrl,
                        profileUrl: variants.profileUrl,
                        fullscreenUrl: variants.fullscreenUrl,
                    },
                ];
            }),
        );

        // Batch check online status via Redis
        const onlineChecks = await Promise.all(
            otherUserIds.map(id => this.redisService.isUserOnline(id)),
        );
        const onlineMap = new Map(otherUserIds.map((id, i) => [id, onlineChecks[i]]));

        const enriched = matches.map((match) => {
            const otherUserId = match.user1Id === userId ? match.user2Id : match.user1Id;
            const otherUser = match.user1Id === userId ? match.user2 : match.user1;
            const hasActivePremium = this.hasActivePremiumEntitlement(otherUser);
            const maskedByGhost = otherUser?.isGhostModeEnabled === true;
            const photoSet = photoMap.get(otherUserId);
            return {
                id: match.id,
                matchedAt: match.matchedAt,
                user: {
                    id: otherUser.id,
                    firstName: maskedByGhost ? 'Ghost' : otherUser.firstName,
                    lastName: maskedByGhost ? 'Member' : otherUser.lastName,
                    photo: maskedByGhost ? null : (photoSet?.thumbnailUrl || null),
                    photoCard: maskedByGhost ? null : (photoSet?.cardUrl || null),
                    photoProfile: maskedByGhost ? null : (photoSet?.profileUrl || null),
                    photoFullscreen: maskedByGhost ? null : (photoSet?.fullscreenUrl || null),
                    isGhostModeEnabled: maskedByGhost,
                    isPremium: hasActivePremium,
                    premiumStartDate: otherUser.premiumStartDate ?? null,
                    premiumExpiryDate: otherUser.premiumExpiryDate ?? null,
                    isOnline: onlineMap.get(otherUserId) || false,
                    status: otherUser.status,
                },
            };
        });

        return { matches: enriched, total, page: pagination.page, limit: pagination.limit };
    }

    async unmatch(userId: string, matchId: string): Promise<void> {
        const match = await this.matchRepository.findOne({
            where: [
                { id: matchId, user1Id: userId },
                { id: matchId, user2Id: userId },
            ],
        });
        if (!match) throw new NotFoundException('Match not found');

        match.status = MatchStatus.UNMATCHED;
        await this.matchRepository.save(match);

        // Delete the associated conversation so it disappears for BOTH users
        const conversation = await this.conversationRepository.findOne({
            where: { matchId: match.id },
        });
        if (conversation) {
            await this.conversationRepository.remove(conversation);
            this.logger.log(`Deleted conversation ${conversation.id} for unmatched match ${matchId}`);
        }

        const counterpartUserId = match.user1Id === userId ? match.user2Id : match.user1Id;
        await this.invalidateDiscoveryCaches(userId, counterpartUserId);
    }

    // ─── NEARBY USERS RADAR ─────────────────────────────────

    async getNearbyUsers(
        userId: string,
        radiusKm: number = 50,
        limit: number = 30,
        country?: string,
        city?: string,
        restrictGallery?: boolean,
    ) {
        const profile = await this.profileRepository.findOne({ where: { userId } });
        if (!profile || !profile.latitude || !profile.longitude) {
            return [];
        }

        const viewerGalleryRestricted =
            restrictGallery ?? (await this.isViewerGalleryRestricted(userId));

        const excludeIds = await this.getExcludeIds(userId);

        // Bounding box pre-filter: narrow candidates before expensive Haversine calc
        // 1 degree latitude ≈ 111km; longitude varies by cos(lat)
        const latDelta = radiusKm / 111;
        const lngDelta = radiusKm / (111 * Math.cos(this.toRad(Number(profile.latitude))));

        const distanceExpr = `(6371 * acos(LEAST(1.0, cos(radians(:lat)) * cos(radians(profile.latitude)) * cos(radians(profile.longitude) - radians(:lng)) + sin(radians(:lat)) * sin(radians(profile.latitude)))))`;

        // Use WHERE instead of HAVING for the distance filter (no GROUP BY needed)
        const query = this.profileRepository
            .createQueryBuilder('profile')
            .leftJoinAndSelect('profile.user', 'user')
            .addSelect(distanceExpr, 'distance')
            .where('profile.userId NOT IN (:...excludeIds)', { excludeIds })
            .andWhere('user.status = :status', { status: 'active' })
            .andWhere('profile.latitude IS NOT NULL')
            .andWhere('profile.longitude IS NOT NULL')
            // Bounding box filter (uses indexes, avoids full-table Haversine)
            .andWhere('profile.latitude BETWEEN :minLat AND :maxLat', {
                minLat: Number(profile.latitude) - latDelta,
                maxLat: Number(profile.latitude) + latDelta,
            })
            .andWhere('profile.longitude BETWEEN :minLng AND :maxLng', {
                minLng: Number(profile.longitude) - lngDelta,
                maxLng: Number(profile.longitude) + lngDelta,
            })
            // Distance filter inline (replaces invalid HAVING without GROUP BY)
            .andWhere(`${distanceExpr} <= :radius`, { radius: radiusKm })
            .setParameters({ lat: profile.latitude, lng: profile.longitude });

        // Apply country/city filters (case-insensitive exact match)
        if (country) {
            query.andWhere(
                `(
                    LOWER(profile.country) = LOWER(:country)
                    OR (
                        "user"."isPassportActive" = true
                        AND LOWER(COALESCE("user"."passportLocation"->>'country', '')) = LOWER(:country)
                    )
                )`,
                { country: country.trim() },
            );
        }
        if (city) {
            query.andWhere(
                `(
                    LOWER(profile.city) = LOWER(:city)
                    OR (
                        "user"."isPassportActive" = true
                        AND LOWER(COALESCE("user"."passportLocation"->>'city', '')) = LOWER(:city)
                    )
                )`,
                { city: city.trim() },
            );
        }

        query.orderBy('distance', 'ASC').take(limit);

        const results = await query.getRawAndEntities();

        return this.enrichProfiles(results.entities, viewerGalleryRestricted, userId);
    }

    // ─── DISCOVERY CATEGORIES ───────────────────────────────

    async getDiscoveryCategories(userId: string) {
        // Cache entire discovery response (5 min TTL)
        const cacheKey = `discovery:${userId}`;
        const cached = await this.redisService.getJson<any>(cacheKey);
        if (cached) return cached;

        const restrictGallery = await this.isViewerGalleryRestricted(userId);

        // Use allSettled so one failure doesn't crash the whole discovery
        const results = await Promise.allSettled([
            this.getNearbyUsers(userId, 30, 10, undefined, undefined, restrictGallery),
            this.getSuggestions(userId, 10, restrictGallery),
            this.getNewUsers(userId, 10, restrictGallery),
        ]);
        const nearby = results[0].status === 'fulfilled' ? results[0].value : [];
        const compatible = results[1].status === 'fulfilled' ? results[1].value : [];
        const newUsers = results[2].status === 'fulfilled' ? results[2].value : [];

        // Merge all into a deduplicated flat 'users' array for the Flutter UsersController
        const seenIds = new Set<string>();
        const allUsers: any[] = [];
        for (const list of [nearby, compatible, newUsers]) {
            for (const u of list) {
                if (!seenIds.has(u.id)) {
                    seenIds.add(u.id);
                    allUsers.push(u);
                }
            }
        }

        const result = {
            users: allUsers,
            nearby: { title: 'Nearby', users: nearby },
            compatible: { title: 'Most Compatible', users: compatible },
            newUsers: { title: 'New Members', users: newUsers },
        };

        await this.redisService.setJson(cacheKey, result, 300);
        return result;
    }

    private async getNewUsers(
        userId: string,
        limit: number,
        restrictGallery?: boolean,
    ) {
        const excludeIds = await this.getExcludeIds(userId);
        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const viewerGalleryRestricted =
            restrictGallery ?? (await this.isViewerGalleryRestricted(userId));

        const profiles = await this.profileRepository
            .createQueryBuilder('profile')
            .leftJoinAndSelect('profile.user', 'user')
            .where('profile.userId NOT IN (:...excludeIds)', { excludeIds })
            .andWhere('user.status = :status', { status: 'active' })
            .andWhere('user.createdAt >= :since', { since: oneWeekAgo })
            .orderBy('user.createdAt', 'DESC')
            .take(limit)
            .getMany();

        return this.enrichProfiles(profiles, viewerGalleryRestricted, userId);
    }

    // ─── SUGGESTIONS ────────────────────────────────────────

    async getSuggestions(
        userId: string,
        limit: number = 20,
        restrictGallery?: boolean,
    ) {
        const cacheKey = `suggestions:${userId}`;
        const cached = await this.redisService.getJson<any[]>(cacheKey);
        if (cached && cached.length > 0) return cached;

        const viewerGalleryRestricted =
            restrictGallery ?? (await this.isViewerGalleryRestricted(userId));

        const profile = await this.profileRepository.findOne({ where: { userId } });
        const preferences = await this.preferenceRepository.findOne({ where: { userId } });

        if (!profile) return [];

        const excludeIds = await this.getExcludeIds(userId);

        const query = this.profileRepository
            .createQueryBuilder('profile')
            .leftJoinAndSelect('profile.user', 'user')
            .where('profile.userId NOT IN (:...excludeIds)', { excludeIds })
            .andWhere('user.status = :status', { status: 'active' });

        // Apply preference filters
        if (preferences) {
            if (preferences.preferredGender) {
                query.andWhere('profile.gender = :gender', { gender: preferences.preferredGender });
            }
            if (preferences.minAge || preferences.maxAge) {
                const now = new Date();
                if (preferences.maxAge) {
                    const minDate = new Date(now.getFullYear() - preferences.maxAge, now.getMonth(), now.getDate());
                    query.andWhere('profile.dateOfBirth >= :minDate', { minDate });
                }
                if (preferences.minAge) {
                    const maxDate = new Date(now.getFullYear() - preferences.minAge, now.getMonth(), now.getDate());
                    query.andWhere('profile.dateOfBirth <= :maxDate', { maxDate });
                }
            }
            if (preferences.preferredReligiousLevel) {
                query.andWhere('profile.religiousLevel = :religiousLevel', { religiousLevel: preferences.preferredReligiousLevel });
            }
            if (preferences.preferredMaritalStatus) {
                query.andWhere('profile.maritalStatus = :maritalStatus', { maritalStatus: preferences.preferredMaritalStatus });
            }
            // Distance filter (LEAST prevents acos domain error from floating point)
            if (preferences.maxDistance && profile.latitude && profile.longitude) {
                query.andWhere(
                    `(6371 * acos(LEAST(1.0, cos(radians(:lat)) * cos(radians(profile.latitude)) * cos(radians(profile.longitude) - radians(:lng)) + sin(radians(:lat)) * sin(radians(profile.latitude))))) <= :maxDist`,
                    { lat: profile.latitude, lng: profile.longitude, maxDist: preferences.maxDistance },
                );
            }
        }

        query.orderBy('profile.activityScore', 'DESC');
        query.addOrderBy('profile.createdAt', 'DESC');
        query.take(limit);

        const suggestions = await query.getMany();

        const enriched = await this.enrichProfiles(
            suggestions,
            viewerGalleryRestricted,
            userId,
        );

        await this.redisService.setJson(cacheKey, enriched, 600);
        return enriched;
    }

    // ─── PRIVATE HELPERS ────────────────────────────────────

    private async enrichProfiles(
        profiles: Profile[],
        viewerGalleryRestricted: boolean,
        viewerId: string,
    ): Promise<any[]> {
        if (profiles.length === 0) return [];

        const userIds = profiles.map(p => p.userId);
        // Batch fetch ALL photos for these users
        const photos = await this.photoRepository
            .createQueryBuilder('photo')
            .where('photo.userId IN (:...userIds)', { userIds })
            .andWhere('photo.moderationStatus = :approvedStatus', { approvedStatus: 'approved' })
            .orderBy('photo.isMain', 'DESC')
            .addOrderBy('photo.order', 'ASC')
            .getMany();

        // Group photos by userId
        const photosMap = new Map<string, any[]>();
        for (const photo of photos) {
            if (!photosMap.has(photo.userId)) photosMap.set(photo.userId, []);
            const variants = CloudinaryService.buildImageUrls(photo.url);
            photosMap.get(photo.userId)!.push({
                id: photo.id,
                originalUrl: variants.originalUrl,
                url: variants.cardUrl,
                thumbnailUrl: variants.thumbnailUrl,
                mediumUrl: variants.cardUrl,
                cardUrl: variants.cardUrl,
                profileUrl: variants.profileUrl,
                fullscreenUrl: variants.fullscreenUrl,
                publicId: photo.publicId,
                isMain: photo.isMain,
                isSelfieVerification: photo.isSelfieVerification,
                order: photo.order,
                moderationStatus: photo.moderationStatus,
                moderationNote: photo.moderationNote,
                createdAt: photo.createdAt,
            });
        }

        return profiles.map((p) => {
            const effectiveProfile = this.resolveEffectiveProfileLocation(p);
            const maskedByGhost = this.shouldMaskGhostProfile(
                p.user as User | undefined,
                viewerId,
            );
            const candidatePhotos = this.applyViewerPhotoAccessPolicy(
                photosMap.get(p.userId) ?? [],
                p.userId,
                viewerGalleryRestricted,
            );
            const publicPhotos = maskedByGhost
                ? this.applyGhostPhotoMask(candidatePhotos, p.userId)
                : candidatePhotos;
            const hasActivePremium = this.hasActivePremiumEntitlement(p.user);

            return {
                // Canonical user id — USE THIS for swipe/rewind/match/message targetUserId.
                // Both `id` and `userId` hold the same value (the users.id FK).
                // Do NOT confuse with nested `profile.id` (which is the profiles row id).
                id: p.userId,
                userId: p.userId,
                username: maskedByGhost ? null : p.user?.username ?? null,
                email: maskedByGhost ? '' : p.user?.email ?? '',
                firstName: maskedByGhost ? 'Ghost' : p.user?.firstName ?? null,
                lastName: maskedByGhost ? 'Member' : p.user?.lastName ?? null,
                phone: maskedByGhost ? null : p.user?.phone ?? null,
                role: p.user?.role ?? 'user',
                status: p.user?.status ?? 'active',
                emailVerified: p.user?.emailVerified ?? false,
                selfieVerified: p.user?.selfieVerified ?? false,
                isShadowBanned: p.user?.isShadowBanned ?? false,
                trustScore: p.user?.trustScore ?? 100,
                flagCount: p.user?.flagCount ?? 0,
                deviceCount: p.user?.deviceCount ?? 0,
                notificationsEnabled: p.user?.notificationsEnabled ?? true,
                isGhostModeEnabled: p.user?.isGhostModeEnabled ?? false,
                isPassportActive:
                    p.user?.isPassportActive === true &&
                    this.extractPassportLocation(p.user as User | undefined) != null,
                isPremium: hasActivePremium,
                premiumStartDate: p.user?.premiumStartDate ?? null,
                premiumExpiryDate: p.user?.premiumExpiryDate ?? null,
                canViewAllPhotos: !viewerGalleryRestricted && !maskedByGhost,
                lastLoginAt: p.user?.lastLoginAt ?? null,
                createdAt: p.user?.createdAt ?? new Date(),
                updatedAt: p.user?.updatedAt ?? new Date(),
                photos: publicPhotos,
                profile: {
                    id: effectiveProfile.id,
                    gender: effectiveProfile.gender,
                    dateOfBirth: effectiveProfile.dateOfBirth,
                    bio: maskedByGhost ? null : effectiveProfile.bio,
                    ethnicity: effectiveProfile.ethnicity,
                    nationality: effectiveProfile.nationality,
                    city: effectiveProfile.city,
                    country: effectiveProfile.country,
                    latitude: effectiveProfile.latitude,
                    longitude: effectiveProfile.longitude,
                    religiousLevel: effectiveProfile.religiousLevel,
                    sect: effectiveProfile.sect,
                    prayerFrequency: effectiveProfile.prayerFrequency,
                    marriageIntention: effectiveProfile.marriageIntention,
                    maritalStatus: effectiveProfile.maritalStatus,
                    education: effectiveProfile.education,
                    jobTitle: maskedByGhost ? null : effectiveProfile.jobTitle,
                    company: maskedByGhost ? null : effectiveProfile.company,
                    height: effectiveProfile.height,
                    weight: effectiveProfile.weight,
                    interests: effectiveProfile.interests,
                    languages: effectiveProfile.languages,
                    intentMode: effectiveProfile.intentMode ?? null,
                    secondWifePreference: effectiveProfile.secondWifePreference ?? null,
                    profileCompletionPercentage: effectiveProfile.profileCompletionPercentage ?? 0,
                    activityScore: effectiveProfile.activityScore ?? 0,
                    isComplete: effectiveProfile.isComplete ?? false,
                },
            };
        });
    }

    private resolveEffectiveProfileLocation(profile: Profile): Profile {
        const passport = this.extractPassportLocation(profile.user as User | undefined);
        if (!passport) {
            return profile;
        }

        return {
            ...profile,
            city: passport.city ?? profile.city,
            country: passport.country ?? profile.country,
            latitude: Number.isFinite(passport.latitude) ? passport.latitude : profile.latitude,
            longitude: Number.isFinite(passport.longitude) ? passport.longitude : profile.longitude,
        } as Profile;
    }

    private extractPassportLocation(
        user:
            | Pick<User, 'isPassportActive' | 'passportLocation'>
            | null
            | undefined,
    ): {
        latitude?: number;
        longitude?: number;
        city?: string;
        country?: string;
    } | null {
        if (!user || user.isPassportActive !== true || !user.passportLocation) {
            return null;
        }

        const location = user.passportLocation;
        if (typeof location !== 'object') {
            return null;
        }

        const city = String(location.city ?? '').trim() || undefined;
        const country = String(location.country ?? '').trim() || undefined;
        const latitude = Number(location.latitude);
        const longitude = Number(location.longitude);

        return {
            latitude: Number.isFinite(latitude) ? latitude : undefined,
            longitude: Number.isFinite(longitude) ? longitude : undefined,
            city,
            country,
        };
    }

    private shouldMaskGhostProfile(
        user: Pick<User, 'id' | 'isGhostModeEnabled'> | undefined,
        viewerId: string,
    ): boolean {
        if (!user) return false;
        return user.isGhostModeEnabled === true && user.id !== viewerId;
    }

    private applyGhostPhotoMask(photos: any[], targetUserId: string): any[] {
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
            id: photo.id ?? `${targetUserId}-ghost-${index + 1}`,
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

    private async isViewerGalleryRestricted(userId: string): Promise<boolean> {
        const viewer = await this.userRepository.findOne({
            where: { id: userId },
            select: {
                id: true,
                selfieVerified: true,
            },
        });

        const isVerified = viewer?.selfieVerified === true;

        // Policy: selfie verification is required to unlock additional gallery photos.
        return !isVerified;
    }

    private applyViewerPhotoAccessPolicy(
        photos: any[],
        targetUserId: string,
        restrictGallery: boolean,
    ): any[] {
        if (!Array.isArray(photos) || photos.length === 0) {
            return [];
        }

        if (!restrictGallery) {
            return photos.map((photo) => ({
                ...photo,
                isLocked: false,
            }));
        }

        const mainPhoto = photos.find((photo) => photo?.isMain) ?? photos[0];
        if (!mainPhoto) {
            return [];
        }

        const lockedCount = Math.max(photos.length - 1, 0);
        const unlockedMain = {
            ...mainPhoto,
            isLocked: false,
        };

        if (lockedCount === 0) {
            return [unlockedMain];
        }

        const lockedPlaceholders = Array.from({ length: lockedCount }).map((_, index) => ({
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
            order: (mainPhoto?.order ?? 0) + index + 1,
            moderationStatus: 'locked',
            moderationNote: null,
            createdAt: mainPhoto?.createdAt ?? null,
            isLocked: true,
            lockReason: 'Verify your selfie to unlock all photos',
            unlockCta: 'Verify selfie now',
        }));

        return [unlockedMain, ...lockedPlaceholders];
    }

    private async getExcludeIds(userId: string): Promise<string[]> {
        // Check Redis cache first (60s TTL)
        const cacheKey = `excludeIds:${userId}`;
        const cached = await this.redisService.getJson<string[]>(cacheKey);
        if (cached && cached.length > 0) return cached;

        // Run all 3 queries in parallel instead of sequentially
        const [blockedUsers, swipedLikes, matches] = await Promise.all([
            this.blockedUserRepository.find({
                where: [{ blockerId: userId }, { blockedId: userId }],
            }),
            this.likeRepository.find({
                where: { likerId: userId },
                select: ['likedId'],
            }),
            this.matchRepository.find({
                where: [
                    { user1Id: userId, status: MatchStatus.ACTIVE },
                    { user2Id: userId, status: MatchStatus.ACTIVE },
                ],
            }),
        ]);

        const blockedIds = blockedUsers.map((b) => b.blockerId === userId ? b.blockedId : b.blockerId);
        const swipedIds = swipedLikes.map((l) => l.likedId);
        const matchedIds = matches.map((m) => m.user1Id === userId ? m.user2Id : m.user1Id);

        const excludeIds = [...new Set([userId, ...blockedIds, ...swipedIds, ...matchedIds])];
        await this.redisService.setJson(cacheKey, excludeIds, 60);
        return excludeIds;
    }

    private async invalidateDiscoveryCaches(...userIds: string[]): Promise<void> {
        const uniqueIds = [
            ...new Set(userIds.map((id) => id?.trim()).filter((id): id is string => !!id)),
        ];

        if (uniqueIds.length === 0) {
            return;
        }

        await Promise.all(
            uniqueIds.flatMap((id) => [
                this.redisService.del(`excludeIds:${id}`),
                this.redisService.del(`discovery:${id}`),
                this.redisService.del(`suggestions:${id}`),
                this.redisService.del(`matches:${id}`),
                this.redisService.del(`conversations:${id}`),
                this.redisService.delByPattern(`search:${id}:*`),
            ]),
        );
    }

    private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371; // Earth's radius in km
        const dLat = this.toRad(lat2 - lat1);
        const dLon = this.toRad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    private toRad(deg: number): number {
        return deg * (Math.PI / 180);
    }

    private calculateAge(dateOfBirth: Date): number {
        const today = new Date();
        const birth = new Date(dateOfBirth);
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
            age--;
        }
        return age;
    }
}

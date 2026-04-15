import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import {
    Profile,
    Gender,
    EducationLevel,
    ReligiousLevel,
    MarriageIntention,
    IntentMode,
} from '../../database/entities/profile.entity';
import { User } from '../../database/entities/user.entity';
import { Photo, PhotoModerationStatus } from '../../database/entities/photo.entity';
import { BlockedUser } from '../../database/entities/blocked-user.entity';
import { Like } from '../../database/entities/like.entity';
import { Match, MatchStatus } from '../../database/entities/match.entity';
import { UserPreference } from '../../database/entities/user-preference.entity';
import { SearchFiltersDto, SearchSortBy } from './dto/search.dto';
import { RedisService } from '../redis/redis.service';
import { CloudinaryService } from '../photos/cloudinary.service';

@Injectable()
export class SearchService {
    private readonly logger = new Logger(SearchService.name);

    constructor(
        @InjectRepository(Profile)
        private readonly profileRepository: Repository<Profile>,
        @InjectRepository(Photo)
        private readonly photoRepository: Repository<Photo>,
        @InjectRepository(BlockedUser)
        private readonly blockedUserRepository: Repository<BlockedUser>,
        @InjectRepository(Like)
        private readonly likeRepository: Repository<Like>,
        @InjectRepository(Match)
        private readonly matchRepository: Repository<Match>,
        @InjectRepository(UserPreference)
        private readonly userPreferenceRepository: Repository<UserPreference>,
        private readonly redisService: RedisService,
    ) { }

    private static readonly SAFE_PREFERENCE_SELECT = {
        id: true,
        userId: true,
        minAge: true,
        maxAge: true,
        preferredGender: true,
        maxDistance: true,
        preferredEthnicities: true,
        preferredNationalities: true,
        preferredReligiousLevel: true,
        preferredMaritalStatus: true,
        preferredInterests: true,
    } as const;

    async search(userId: string, filters: SearchFiltersDto) {
        this.logger.log(
            `[Search] Starting search for userId=${userId}, filters=${JSON.stringify(filters)}`,
        );

        const page = filters.page ?? 1;
        const limit = filters.limit ?? 20;
        const cacheKey = this.buildSearchCacheKey(userId, filters);

        if (!filters.forceRefresh) {
            try {
                const cached = await this.redisService.getJson<any>(cacheKey);
                if (cached) {
                    this.logger.log(`[Search] Cache hit for userId=${userId}`);
                    return cached;
                }
            } catch (err) {
                this.logger.warn(
                    `[Search] Redis cache read failed, continuing without cache: ${err?.message}`,
                );
            }
        } else {
            try {
                await this.redisService.delByPattern(`search:${userId}:*`);
            } catch (_) { }
        }

        if (!userId) {
            this.logger.error('[Search] No userId provided - returning empty results');
            return { users: [], total: 0, page, limit };
        }

        const [blockedIds, currentProfile, currentPreference] = await Promise.all([
            this.getCachedBlockedIds(userId).catch((err) => {
                this.logger.warn(
                    `[Search] Failed to get blocked IDs, continuing: ${err?.message}`,
                );
                return [] as string[];
            }),
            this.profileRepository.findOne({
                where: { userId },
                relations: ['user'],
            }),
            this.userPreferenceRepository.findOne({
                where: { userId },
                select: SearchService.SAFE_PREFERENCE_SELECT,
            }),
        ]);

        if (!currentProfile) {
            this.logger.warn(`[Search] No profile found for userId=${userId}`);
            return { users: [], total: 0, page, limit };
        }

        const effectiveViewerProfile = this.resolveEffectiveProfileLocation(currentProfile);
        const effectiveFilters = this.withPassportCountryOverride(
            filters,
            currentProfile.user as User | undefined,
        );

        const excludeIds = [userId, ...blockedIds].filter(Boolean);
        const activeCutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        const hasUserLocation = !!(effectiveViewerProfile.latitude && effectiveViewerProfile.longitude);
        const candidateFetchLimit = Math.min(Math.max(page * limit * 10, 200), 1000);

        const query = this.profileRepository
            .createQueryBuilder('profile')
            .leftJoinAndSelect('profile.user', 'user')
            .where(
                excludeIds.length > 0
                    ? 'profile.userId NOT IN (:...excludeIds)'
                    : '1=1',
                { excludeIds: excludeIds.length > 0 ? excludeIds : ['__none__'] },
            )
            .andWhere(
                (qb) => {
                    const subQuery = qb
                        .subQuery()
                        .select('1')
                        .from(Like, 'swipe_like')
                        .where('swipe_like.likerId = :userId')
                        .andWhere('swipe_like.likedId = profile.userId')
                        .getQuery();
                    return `NOT EXISTS ${subQuery}`;
                },
                { userId },
            )
            .andWhere(
                (qb) => {
                    const subQuery = qb
                        .subQuery()
                        .select('1')
                        .from(Match, 'match')
                        .where('match.status = :activeMatchStatus')
                        .andWhere(
                            '((match.user1Id = :userId AND match.user2Id = profile.userId) OR (match.user2Id = :userId AND match.user1Id = profile.userId))',
                        )
                        .getQuery();
                    return `NOT EXISTS ${subQuery}`;
                },
                { userId, activeMatchStatus: MatchStatus.ACTIVE },
            )
            .andWhere(
                (qb) => {
                    const subQuery = qb
                        .subQuery()
                        .select('1')
                        .from(Photo, 'approved_photo')
                        .where('approved_photo.userId = profile.userId')
                        .andWhere('approved_photo.moderationStatus = :approvedStatus')
                        .getQuery();
                    return `EXISTS ${subQuery}`;
                },
                { approvedStatus: PhotoModerationStatus.APPROVED },
            )
            .andWhere('user.status = :status', { status: 'active' })
            .andWhere('user.isShadowBanned = :shadowBanned', { shadowBanned: false })
            .andWhere('profile.profileCompletionPercentage >= :minimumCompletion', {
                minimumCompletion: 20,
            })
            .andWhere('(user.lastLoginAt IS NULL OR user.lastLoginAt >= :activeCutoff)', {
                activeCutoff,
            });

        this.applyGenderFilter(query, effectiveFilters, effectiveViewerProfile, currentPreference);
        this.applyExplicitFilters(query, effectiveFilters, effectiveViewerProfile, hasUserLocation);
        this.applySavedPreferenceFilters(
            query,
            currentPreference,
            effectiveViewerProfile,
            hasUserLocation,
            effectiveFilters,
        );

        // Always compute distance when user has location (needed for ranking + response)
        if (hasUserLocation) {
            query.addSelect(
                `(6371 * acos(LEAST(1.0, cos(radians(:orderLat)) * cos(radians(profile.latitude)) * cos(radians(profile.longitude) - radians(:orderLng)) + sin(radians(:orderLat)) * sin(radians(profile.latitude)))))`,
                'distance',
            );
            query.setParameter('orderLat', effectiveViewerProfile.latitude);
            query.setParameter('orderLng', effectiveViewerProfile.longitude);
        }

        // SQL-level ordering depends on sortBy
        const effectiveSortBy = effectiveFilters.sortBy ?? SearchSortBy.DISTANCE;
        if (effectiveSortBy === SearchSortBy.DISTANCE && hasUserLocation) {
            query.orderBy('distance', 'ASC');
        } else if (effectiveSortBy === SearchSortBy.NEWEST) {
            query.orderBy('profile.createdAt', 'DESC');
        } else if (effectiveSortBy === SearchSortBy.ACTIVITY) {
            query.orderBy('profile.activityScore', 'DESC');
        } else {
            // COMPATIBILITY or default — use activity as initial SQL sort,
            // then re-rank in-memory by compatibility
            if (hasUserLocation) {
                query.orderBy('distance', 'ASC');
            } else {
                query.orderBy('profile.activityScore', 'DESC');
            }
        }

        query.take(candidateFetchLimit);

        const candidateProfiles = await query.getMany();
        if (candidateProfiles.length === 0) {
            const emptyResponse = { users: [], total: 0, page, limit };
            try {
                await this.redisService.setJson(cacheKey, emptyResponse, 180);
            } catch (_) { }
            return emptyResponse;
        }

        const candidateUserIds = candidateProfiles.map((profile) => profile.userId);
        const [candidatePreferences, photos, onlineUsers] = await Promise.all([
            candidateUserIds.length > 0
                ? this.userPreferenceRepository
                      .createQueryBuilder('preference')
                      .select([
                          'preference.id',
                          'preference.userId',
                          'preference.minAge',
                          'preference.maxAge',
                          'preference.preferredGender',
                          'preference.maxDistance',
                          'preference.preferredEthnicities',
                          'preference.preferredNationalities',
                          'preference.preferredReligiousLevel',
                          'preference.preferredMaritalStatus',
                          'preference.preferredInterests',
                      ])
                      .where('preference.userId IN (:...candidateUserIds)', {
                          candidateUserIds,
                      })
                      .getMany()
                : Promise.resolve([]),
            this.photoRepository
                .createQueryBuilder('photo')
                .where('photo.userId IN (:...candidateUserIds)', { candidateUserIds })
                .andWhere('photo.moderationStatus = :approvedStatus', {
                    approvedStatus: PhotoModerationStatus.APPROVED,
                })
                .orderBy('photo.isMain', 'DESC')
                .addOrderBy('photo.order', 'ASC')
                .getMany(),
            this.redisService.getOnlineUsers().catch((err) => {
                this.logger.warn(`[Search] Failed to fetch online users: ${err?.message}`);
                return [] as string[];
            }),
        ]);

        const candidatePreferenceMap = new Map(
            candidatePreferences.map((preference) => [preference.userId, preference]),
        );
        const photosMap = new Map<string, any[]>();
        for (const photo of photos) {
            if (!photosMap.has(photo.userId)) {
                photosMap.set(photo.userId, []);
            }
            const variants = this.resolvePhotoVariants(photo.url);
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
        const onlineUserSet = new Set(onlineUsers);
        const restrictGalleryForViewer = this.isViewerGalleryRestricted(
            currentProfile,
        );

        const rankedCandidates = candidateProfiles
            .filter((candidate) =>
                this.matchesPreference(
                    currentPreference,
                    this.resolveEffectiveProfileLocation(candidate),
                    effectiveViewerProfile,
                ),
            )
            .filter((candidate) =>
                this.matchesPreference(
                    candidatePreferenceMap.get(candidate.userId),
                    effectiveViewerProfile,
                    this.resolveEffectiveProfileLocation(candidate),
                ),
            )
            .map((candidate) => {
                const effectiveCandidateProfile = this.resolveEffectiveProfileLocation(candidate);
                const maskedByGhost = this.shouldMaskGhostProfile(
                    candidate.user as User | undefined,
                    userId,
                );

                const candidatePhotos = this.applyViewerPhotoAccessPolicy(
                    photosMap.get(candidate.userId) ?? [],
                    candidate.userId,
                    restrictGalleryForViewer,
                );
                const publicPhotos = maskedByGhost
                    ? this.applyGhostPhotoMask(candidatePhotos, candidate.userId)
                    : candidatePhotos;
                const compatibilityScore = this.computeCompatibility(
                    effectiveViewerProfile,
                    effectiveCandidateProfile,
                    effectiveViewerProfile.user?.selfieVerified ?? false,
                    candidate.user?.selfieVerified ?? false,
                );
                const commonInterests = this.getCommonInterests(
                    effectiveViewerProfile.interests,
                    effectiveCandidateProfile.interests,
                );
                const distanceKm = this.calculateDistanceKm(
                    effectiveViewerProfile,
                    effectiveCandidateProfile,
                );
                const lastActiveAt = candidate.user?.lastLoginAt
                    ? new Date(candidate.user.lastLoginAt).getTime()
                    : 0;

                return {
                    profile: effectiveCandidateProfile,
                    photos: publicPhotos,
                    maskedByGhost,
                    compatibilityScore,
                    commonInterests,
                    distanceKm,
                    lastActiveAt,
                };
            })
            .sort((a, b) => {
                // ─── Sort priority based on sortBy param ───
                if (effectiveSortBy === SearchSortBy.DISTANCE) {
                    // Distance-first: nearest to farthest
                    const distA = a.distanceKm ?? Infinity;
                    const distB = b.distanceKm ?? Infinity;
                    if (distA !== distB) return distA - distB;
                    // Tiebreak: compatibility, then activity
                    if (b.compatibilityScore !== a.compatibilityScore) {
                        return b.compatibilityScore - a.compatibilityScore;
                    }
                    return (b.profile.activityScore ?? 0) - (a.profile.activityScore ?? 0);
                }

                if (effectiveSortBy === SearchSortBy.NEWEST) {
                    const dateA = a.profile.createdAt?.getTime() ?? 0;
                    const dateB = b.profile.createdAt?.getTime() ?? 0;
                    if (dateB !== dateA) return dateB - dateA;
                    const distA = a.distanceKm ?? Infinity;
                    const distB = b.distanceKm ?? Infinity;
                    return distA - distB;
                }

                if (effectiveSortBy === SearchSortBy.ACTIVITY) {
                    if ((b.profile.activityScore ?? 0) !== (a.profile.activityScore ?? 0)) {
                        return (b.profile.activityScore ?? 0) - (a.profile.activityScore ?? 0);
                    }
                    const distA = a.distanceKm ?? Infinity;
                    const distB = b.distanceKm ?? Infinity;
                    return distA - distB;
                }

                // COMPATIBILITY (default fallback)
                if (b.compatibilityScore !== a.compatibilityScore) {
                    return b.compatibilityScore - a.compatibilityScore;
                }
                const completionA = a.profile.profileCompletionPercentage ?? 0;
                const completionB = b.profile.profileCompletionPercentage ?? 0;
                if (completionB !== completionA) {
                    return completionB - completionA;
                }
                if (b.lastActiveAt !== a.lastActiveAt) {
                    return b.lastActiveAt - a.lastActiveAt;
                }
                return (b.profile.activityScore ?? 0) - (a.profile.activityScore ?? 0);
            });

        const total = rankedCandidates.length;
        const start = (page - 1) * limit;
        const pagedUsers = rankedCandidates.slice(start, start + limit);

        const users = pagedUsers.map(
            ({
                profile,
                photos: profilePhotos,
                maskedByGhost,
                compatibilityScore,
                commonInterests,
                distanceKm,
            }) => ({
                id: profile.userId,
                username: maskedByGhost ? null : profile.user?.username ?? null,
                email: maskedByGhost ? '' : profile.user?.email ?? '',
                firstName: maskedByGhost ? 'Ghost' : profile.user?.firstName ?? null,
                lastName: maskedByGhost ? 'Member' : profile.user?.lastName ?? null,
                phone: maskedByGhost ? null : profile.user?.phone ?? null,
                role: profile.user?.role ?? 'user',
                status: profile.user?.status ?? 'active',
                emailVerified: profile.user?.emailVerified ?? false,
                selfieVerified: profile.user?.selfieVerified ?? false,
                isShadowBanned: profile.user?.isShadowBanned ?? false,
                trustScore: profile.user?.trustScore ?? 100,
                flagCount: profile.user?.flagCount ?? 0,
                deviceCount: profile.user?.deviceCount ?? 0,
                notificationsEnabled: profile.user?.notificationsEnabled ?? true,
                isGhostModeEnabled: this.readBooleanFlag(
                    profile.user as unknown as Record<string, unknown> | undefined,
                    'isGhostModeEnabled',
                ),
                isPassportActive:
                    this.readBooleanFlag(
                        profile.user as unknown as Record<string, unknown> | undefined,
                        'isPassportActive',
                    ) && this.extractPassportLocation(profile.user as unknown as Record<string, unknown> | undefined) != null,
                isPremium: this.hasActivePremiumEntitlement(profile.user),
                premiumStartDate: profile.user?.premiumStartDate ?? null,
                premiumExpiryDate: profile.user?.premiumExpiryDate ?? null,
                canViewAllPhotos: !restrictGalleryForViewer && !maskedByGhost,
                lastLoginAt: profile.user?.lastLoginAt ?? null,
                createdAt: profile.user?.createdAt ?? new Date(),
                updatedAt: profile.user?.updatedAt ?? new Date(),
                isOnline: onlineUserSet.has(profile.userId),
                compatibilityScore,
                commonInterests,
                distanceKm,
                age: this.calculateAge(profile.dateOfBirth),
                photos: profilePhotos,
                profile: {
                    id: profile.id,
                    gender: profile.gender,
                    dateOfBirth: profile.dateOfBirth,
                    bio: maskedByGhost ? null : profile.bio,
                    ethnicity: profile.ethnicity,
                    nationality: profile.nationality,
                    nationalities: profile.nationalities,
                    city: profile.city,
                    country: profile.country,
                    latitude: profile.latitude,
                    longitude: profile.longitude,
                    religiousLevel: profile.religiousLevel,
                    sect: profile.sect,
                    prayerFrequency: profile.prayerFrequency,
                    marriageIntention: profile.marriageIntention,
                    maritalStatus: profile.maritalStatus,
                    education: profile.education,
                    jobTitle: profile.jobTitle,
                    company: profile.company,
                    height: profile.height,
                    weight: profile.weight,
                    familyPlans: profile.familyPlans,
                    familyValues: profile.familyValues,
                    interests: profile.interests,
                    languages: profile.languages,
                    aboutPartner: profile.aboutPartner,
                    intentMode: profile.intentMode ?? null,
                    secondWifePreference: profile.secondWifePreference ?? null,
                    profileCompletionPercentage: profile.profileCompletionPercentage ?? 0,
                    activityScore: profile.activityScore ?? 0,
                    isComplete: profile.isComplete ?? false,
                },
            }),
        );

        const response = {
            users,
            total,
            page,
            limit,
        };

        try {
            await this.redisService.setJson(cacheKey, response, 180);
        } catch (err) {
            this.logger.warn(
                `[Search] Redis cache write failed, continuing: ${err?.message}`,
            );
        }

        this.logger.log(
            `[Search] Returning ${users.length} ranked users for userId=${userId} (total=${total})`,
        );
        return response;
    }

    private applyGenderFilter(
        query: SelectQueryBuilder<Profile>,
        filters: SearchFiltersDto,
        currentProfile: Profile,
        currentPreference: UserPreference | null,
    ): void {
        if (filters.gender) {
            query.andWhere('profile.gender = :gender', { gender: filters.gender });
            return;
        }

        const preferredGender = currentPreference?.preferredGender;
        if (preferredGender) {
            query.andWhere('profile.gender = :gender', { gender: preferredGender });
            return;
        }

        if (currentProfile.gender) {
            const oppositeGender =
                currentProfile.gender === Gender.MALE ? Gender.FEMALE : Gender.MALE;
            query.andWhere('profile.gender = :gender', { gender: oppositeGender });
            this.logger.log(`[Search] Auto-filtering to opposite gender: ${oppositeGender}`);
        }
    }

    private applyExplicitFilters(
        query: SelectQueryBuilder<Profile>,
        filters: SearchFiltersDto,
        currentProfile: Profile,
        hasUserLocation: boolean,
    ): void {
        const extendedFilters = filters as SearchFiltersDto & {
            timeFrame?: MarriageIntention;
            intentMode?: IntentMode;
            recentlyActiveOnly?: boolean;
            withPhotosOnly?: boolean;
            minTrustScore?: number;
            backgroundCheckStatus?: string;
            communicationStyles?: string[];
        };

        if (filters.city) {
            const normalizedCity = filters.city.trim();
            query.andWhere(
                `(
                    LOWER(profile.city) LIKE LOWER(:cityLike)
                    OR (
                        user."isPassportActive" = true
                        AND LOWER(COALESCE(user."passportLocation"->>'city', '')) LIKE LOWER(:cityLike)
                    )
                )`,
                {
                    cityLike: `%${normalizedCity}%`,
                },
            );
        }

        if (filters.country) {
            const normalizedCountry = filters.country.trim();
            query.andWhere(
                `(
                    LOWER(TRIM(profile.country)) = LOWER(TRIM(:countryExact))
                    OR LOWER(profile.country) LIKE LOWER(:countryLike)
                    OR (
                        user."isPassportActive" = true
                        AND LOWER(TRIM(COALESCE(user."passportLocation"->>'country', ''))) = LOWER(TRIM(:countryExact))
                    )
                    OR (
                        user."isPassportActive" = true
                        AND LOWER(COALESCE(user."passportLocation"->>'country', '')) LIKE LOWER(:countryLike)
                    )
                )`,
                {
                    countryExact: normalizedCountry,
                    countryLike: `%${normalizedCountry}%`,
                },
            );
        }

        const effectiveTimeFrame = this.normalizeValue(
            extendedFilters.timeFrame || filters.marriageIntention,
        );

        if (filters.maritalStatus) {
            query.andWhere('profile.maritalStatus = :maritalStatus', {
                maritalStatus: filters.maritalStatus,
            });
        }

        if (filters.religiousLevel) {
            query.andWhere('profile.religiousLevel = :religiousLevel', {
                religiousLevel: filters.religiousLevel,
            });
        }

        if (filters.ethnicity) {
            query.andWhere('LOWER(profile.ethnicity) LIKE LOWER(:ethnicity)', {
                ethnicity: `%${filters.ethnicity}%`,
            });
        }

        if (filters.minAge || filters.maxAge) {
            const now = new Date();
            if (filters.maxAge) {
                const minDate = new Date(
                    now.getFullYear() - filters.maxAge,
                    now.getMonth(),
                    now.getDate(),
                );
                query.andWhere('profile.dateOfBirth >= :minDate', { minDate });
            }
            if (filters.minAge) {
                const maxDate = new Date(
                    now.getFullYear() - filters.minAge,
                    now.getMonth(),
                    now.getDate(),
                );
                query.andWhere('profile.dateOfBirth <= :maxDate', { maxDate });
            }
        }

        if (filters.education) {
            query.andWhere('profile.education = :education', {
                education: filters.education,
            });
        }

        if (filters.prayerFrequency) {
            query.andWhere('profile.prayerFrequency = :prayerFrequency', {
                prayerFrequency: filters.prayerFrequency,
            });
        }

        if (effectiveTimeFrame) {
            const legacyIntentModes = this.legacyIntentModesForTimeFrame(
                effectiveTimeFrame,
            );
            if (legacyIntentModes.length > 0) {
                query.andWhere(
                    '(profile.marriageIntention = :effectiveTimeFrame OR profile.intentMode IN (:...legacyIntentModes))',
                    {
                        effectiveTimeFrame,
                        legacyIntentModes,
                    },
                );
            } else {
                query.andWhere('profile.marriageIntention = :effectiveTimeFrame', {
                    effectiveTimeFrame,
                });
            }
        }

        if (!effectiveTimeFrame && extendedFilters.intentMode) {
            query.andWhere('profile.intentMode = :intentMode', {
                intentMode: extendedFilters.intentMode,
            });
        }

        if (filters.livingSituation) {
            query.andWhere('profile.livingSituation = :livingSituation', {
                livingSituation: filters.livingSituation,
            });
        }

        if (filters.interests && filters.interests.length > 0) {
            const interestConditions = filters.interests.map((interest, index) => {
                const parameterName = `interest_${index}`;
                query.setParameter(parameterName, `%${this.normalizeValue(interest)}%`);
                return `LOWER(profile.interests) LIKE :${parameterName}`;
            });
            query.andWhere(`(${interestConditions.join(' OR ')})`);
        }

        if (filters.languages && filters.languages.length > 0) {
            const languageConditions = filters.languages.map((language, index) => {
                const parameterName = `language_${index}`;
                query.setParameter(parameterName, `%${this.normalizeValue(language)}%`);
                return `LOWER(profile.languages) LIKE :${parameterName}`;
            });
            query.andWhere(`(${languageConditions.join(' OR ')})`);
        }

        if (filters.familyValues && filters.familyValues.length > 0) {
            const familyValueConditions = filters.familyValues.map((familyValue, index) => {
                const parameterName = `familyValue_${index}`;
                const normalizedValue = this.normalizeValue(familyValue);
                query.setParameter(parameterName, `%${normalizedValue}%`);
                query.setParameter(
                    `${parameterName}_spaces`,
                    `%${normalizedValue.replace(/_/g, ' ')}%`,
                );
                query.setParameter(
                    `${parameterName}_underscores`,
                    `%${normalizedValue.replace(/\s+/g, '_')}%`,
                );
                return `(
                    LOWER(profile.familyValues) LIKE :${parameterName}
                    OR LOWER(profile.familyValues) LIKE :${parameterName}_spaces
                    OR LOWER(profile.familyValues) LIKE :${parameterName}_underscores
                )`;
            });
            query.andWhere(`(${familyValueConditions.join(' OR ')})`);
        }

        if (filters.nationalities && filters.nationalities.length > 0) {
            const nationalityConditions = filters.nationalities.map((nationality, index) => {
                const parameterName = `nationality_${index}`;
                query.setParameter(parameterName, `%${this.normalizeValue(nationality)}%`);
                return `(
                    LOWER(profile.nationality) LIKE :${parameterName}
                    OR LOWER(profile.nationalities) LIKE :${parameterName}
                )`;
            });
            query.andWhere(`(${nationalityConditions.join(' OR ')})`);
        }

        if (filters.verifiedOnly) {
            query.andWhere('user.selfieVerified = :verified', { verified: true });
        }

        if (filters.onlineOnly) {
            query.andWhere('user.lastLoginAt >= :recentCutoff', {
                recentCutoff: new Date(Date.now() - 5 * 60 * 1000),
            });
        }

        if (extendedFilters.recentlyActiveOnly) {
            query.andWhere('user.lastLoginAt >= :recentlyActiveCutoff', {
                recentlyActiveCutoff: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            });
        }

        if (extendedFilters.withPhotosOnly) {
            query.andWhere(
                (qb) => {
                    const subQuery = qb
                        .subQuery()
                        .select('1')
                        .from(Photo, 'wp_photo')
                        .where('wp_photo.userId = profile.userId')
                        .andWhere('wp_photo.moderationStatus = :wpApprovedStatus')
                        .getQuery();
                    return `EXISTS ${subQuery}`;
                },
                { wpApprovedStatus: PhotoModerationStatus.APPROVED },
            );
        }

        if (extendedFilters.minTrustScore && extendedFilters.minTrustScore > 0) {
            query.andWhere('user.trustScore >= :minTrustScore', {
                minTrustScore: extendedFilters.minTrustScore,
            });
        }

        if (extendedFilters.backgroundCheckStatus) {
            query.andWhere('user.backgroundCheckStatus = :bgCheckStatus', {
                bgCheckStatus: extendedFilters.backgroundCheckStatus,
            });
        }

        if (extendedFilters.communicationStyles && extendedFilters.communicationStyles.length > 0) {
            const normalizedStyles = Array.from(
                new Set(
                    extendedFilters.communicationStyles
                        .map((style) => this.normalizeCommunicationStyle(style))
                        .filter(Boolean),
                ),
            );
            if (normalizedStyles.length > 0) {
                query.andWhere(
                    'LOWER(profile.communicationStyle) IN (:...communicationStyles)',
                    { communicationStyles: normalizedStyles },
                );
            }
        }

        if (filters.maxDistance && hasUserLocation) {
            this.applyDistanceConstraint(query, currentProfile, filters.maxDistance, 'search');
        }

        if (filters.q) {
            query.andWhere('LOWER(profile.bio) LIKE LOWER(:q)', {
                q: `%${filters.q}%`,
            });
        }

        if (filters.name) {
            query.andWhere(
                '(LOWER(user.firstName) LIKE LOWER(:nameSearch) OR LOWER(user.lastName) LIKE LOWER(:nameSearch))',
                { nameSearch: `%${filters.name}%` },
            );
        }
    }

    private applySavedPreferenceFilters(
        query: SelectQueryBuilder<Profile>,
        currentPreference: UserPreference | null,
        currentProfile: Profile,
        hasUserLocation: boolean,
        filters: SearchFiltersDto,
    ): void {
        if (!currentPreference) {
            return;
        }

        const extendedFilters = filters as SearchFiltersDto & { goGlobal?: boolean };

        const now = new Date();
        if (!filters.maxAge && currentPreference.maxAge) {
            const minDate = new Date(
                now.getFullYear() - currentPreference.maxAge,
                now.getMonth(),
                now.getDate(),
            );
            query.andWhere('profile.dateOfBirth >= :savedMinDate', {
                savedMinDate: minDate,
            });
        }
        if (!filters.minAge && currentPreference.minAge) {
            const maxDate = new Date(
                now.getFullYear() - currentPreference.minAge,
                now.getMonth(),
                now.getDate(),
            );
            query.andWhere('profile.dateOfBirth <= :savedMaxDate', {
                savedMaxDate: maxDate,
            });
        }
        if (!filters.religiousLevel && currentPreference.preferredReligiousLevel) {
            query.andWhere('profile.religiousLevel = :savedReligiousLevel', {
                savedReligiousLevel: currentPreference.preferredReligiousLevel,
            });
        }
        if (!filters.maritalStatus && currentPreference.preferredMaritalStatus) {
            query.andWhere('profile.maritalStatus = :savedMaritalStatus', {
                savedMaritalStatus: currentPreference.preferredMaritalStatus,
            });
        }
        if (
            (!filters.languages || filters.languages.length === 0) &&
            currentPreference.preferredLanguages?.length
        ) {
            const preferredLanguageConditions = currentPreference.preferredLanguages.map((language, index) => {
                const parameterName = `savedLanguage_${index}`;
                query.setParameter(parameterName, `%${this.normalizeValue(language)}%`);
                return `LOWER(profile.languages) LIKE :${parameterName}`;
            });
            query.andWhere(`(${preferredLanguageConditions.join(' OR ')})`);
        }
        if (
            (!filters.familyValues || filters.familyValues.length === 0) &&
            currentPreference.preferredFamilyValues?.length
        ) {
            const preferredFamilyConditions = currentPreference.preferredFamilyValues.map((familyValue, index) => {
                const parameterName = `savedFamilyValue_${index}`;
                const normalizedValue = this.normalizeValue(familyValue);
                query.setParameter(parameterName, `%${normalizedValue}%`);
                query.setParameter(
                    `${parameterName}_spaces`,
                    `%${normalizedValue.replace(/_/g, ' ')}%`,
                );
                query.setParameter(
                    `${parameterName}_underscores`,
                    `%${normalizedValue.replace(/\s+/g, '_')}%`,
                );
                return `(
                    LOWER(profile.familyValues) LIKE :${parameterName}
                    OR LOWER(profile.familyValues) LIKE :${parameterName}_spaces
                    OR LOWER(profile.familyValues) LIKE :${parameterName}_underscores
                )`;
            });
            query.andWhere(`(${preferredFamilyConditions.join(' OR ')})`);
        }
        if (
            currentPreference.maxDistance &&
            hasUserLocation &&
            !filters.maxDistance &&
            !extendedFilters.goGlobal
        ) {
            this.applyDistanceConstraint(
                query,
                currentProfile,
                currentPreference.maxDistance,
                'saved',
            );
        }
    }

    private legacyIntentModesForTimeFrame(timeFrame: string): IntentMode[] {
        switch (timeFrame) {
            case MarriageIntention.WITHIN_MONTHS:
                return [IntentMode.FAMILY_INTRODUCTION, IntentMode.SERIOUS_MARRIAGE];
            case MarriageIntention.WITHIN_YEAR:
            case MarriageIntention.ONE_TO_TWO_YEARS:
                return [IntentMode.SERIOUS_MARRIAGE];
            case MarriageIntention.JUST_EXPLORING:
                return [IntentMode.EXPLORING];
            case MarriageIntention.NOT_SURE:
            default:
                return [];
        }
    }

    private applyDistanceConstraint(
        query: SelectQueryBuilder<Profile>,
        currentProfile: Profile,
        maxDistance: number,
        prefix: string,
    ): void {
        const latitude = Number(currentProfile.latitude);
        const longitude = Number(currentProfile.longitude);
        const latDelta = maxDistance / 111;
        const lngDelta = maxDistance / (111 * Math.cos((latitude * Math.PI) / 180));

        query.andWhere(
            `(profile.latitude BETWEEN :${prefix}MinLat AND :${prefix}MaxLat AND profile.longitude BETWEEN :${prefix}MinLng AND :${prefix}MaxLng AND (6371 * acos(cos(radians(:${prefix}UserLat)) * cos(radians(profile.latitude)) * cos(radians(profile.longitude) - radians(:${prefix}UserLng)) + sin(radians(:${prefix}UserLat)) * sin(radians(profile.latitude)))) <= :${prefix}MaxDistance)`,
            {
                [`${prefix}MinLat`]: latitude - latDelta,
                [`${prefix}MaxLat`]: latitude + latDelta,
                [`${prefix}MinLng`]: longitude - lngDelta,
                [`${prefix}MaxLng`]: longitude + lngDelta,
                [`${prefix}UserLat`]: latitude,
                [`${prefix}UserLng`]: longitude,
                [`${prefix}MaxDistance`]: maxDistance,
            },
        );
    }

    private matchesPreference(
        preference: UserPreference | null | undefined,
        candidateProfile: Profile,
        referenceProfile: Profile,
    ): boolean {
        if (!preference) {
            return true;
        }

        if (preference.preferredGender && candidateProfile.gender !== preference.preferredGender) {
            return false;
        }

        if (candidateProfile.dateOfBirth) {
            const age = this.calculateAge(candidateProfile.dateOfBirth);
            if (preference.minAge && age < preference.minAge) {
                return false;
            }
            if (preference.maxAge && age > preference.maxAge) {
                return false;
            }
        }

        if (
            preference.preferredReligiousLevel &&
            candidateProfile.religiousLevel !== preference.preferredReligiousLevel
        ) {
            return false;
        }

        if (
            preference.preferredMaritalStatus &&
            candidateProfile.maritalStatus !== preference.preferredMaritalStatus
        ) {
            return false;
        }

        if (preference.preferredEthnicities?.length) {
            const candidateEthnicity = this.normalizeValue(candidateProfile.ethnicity);
            const allowedEthnicities = preference.preferredEthnicities
                .map((value) => this.normalizeValue(value))
                .filter(Boolean);
            if (!candidateEthnicity || !allowedEthnicities.includes(candidateEthnicity)) {
                return false;
            }
        }

        if (preference.preferredNationalities?.length) {
            const candidateNationalities = [candidateProfile.nationality, ...(candidateProfile.nationalities ?? [])]
                .map((value) => this.normalizeValue(value))
                .filter(Boolean);
            const preferredNationalities = preference.preferredNationalities
                .map((value) => this.normalizeValue(value))
                .filter(Boolean);
            const hasNationalityMatch = candidateNationalities.some((value) =>
                preferredNationalities.includes(value),
            );
            if (!hasNationalityMatch) {
                return false;
            }
        }

        if (preference.preferredInterests?.length) {
            const candidateInterests = (candidateProfile.interests ?? [])
                .map((value) => this.normalizeValue(value))
                .filter(Boolean);
            const preferredInterests = preference.preferredInterests
                .map((value) => this.normalizeValue(value))
                .filter(Boolean);
            const hasInterestMatch = candidateInterests.some((value) =>
                preferredInterests.includes(value),
            );
            if (!hasInterestMatch) {
                return false;
            }
        }

        if (preference.preferredLanguages?.length) {
            const candidateLanguages = (candidateProfile.languages ?? [])
                .map((value) => this.normalizeValue(value))
                .filter(Boolean);
            const preferredLanguages = preference.preferredLanguages
                .map((value) => this.normalizeValue(value))
                .filter(Boolean);
            const hasLanguageMatch = candidateLanguages.some((value) =>
                preferredLanguages.includes(value),
            );
            if (!hasLanguageMatch) {
                return false;
            }
        }

        if (preference.preferredFamilyValues?.length) {
            const candidateFamilyValues = (candidateProfile.familyValues ?? [])
                .map((value) => this.normalizeValue(value))
                .filter(Boolean);
            const preferredFamilyValues = preference.preferredFamilyValues
                .map((value) => this.normalizeValue(value))
                .filter(Boolean);
            const hasFamilyValueMatch = candidateFamilyValues.some((value) =>
                preferredFamilyValues.includes(value),
            );
            if (!hasFamilyValueMatch) {
                return false;
            }
        }

        if (preference.maxDistance && referenceProfile.latitude && referenceProfile.longitude) {
            const distanceKm = this.calculateDistanceKm(referenceProfile, candidateProfile);
            if (distanceKm == null || distanceKm > preference.maxDistance) {
                return false;
            }
        }

        return true;
    }

    private computeCompatibility(
        source: Profile,
        candidate: Profile,
        sourceVerified: boolean,
        candidateVerified: boolean,
    ): number {
        let score = 0;

        const sourceInterests = source.interests ?? [];
        const candidateInterests = candidate.interests ?? [];
        if (sourceInterests.length > 0 && candidateInterests.length > 0) {
            const overlap = this.getCommonInterests(sourceInterests, candidateInterests);
            const overlapRatio = overlap.length / Math.max(sourceInterests.length, candidateInterests.length);
            score += Math.round(overlapRatio * 25);
        }

        const sourceLanguages = source.languages ?? [];
        const candidateLanguages = candidate.languages ?? [];
        if (sourceLanguages.length > 0 && candidateLanguages.length > 0) {
            const overlap = this.getCommonInterests(sourceLanguages, candidateLanguages);
            score += Math.round(
                (overlap.length / Math.max(sourceLanguages.length, candidateLanguages.length)) * 10,
            );
        }

        const distanceKm = this.calculateDistanceKm(source, candidate);
        if (distanceKm != null) {
            if (distanceKm <= 10) score += 20;
            else if (distanceKm <= 50) score += 15;
            else if (distanceKm <= 100) score += 10;
            else score += 5;
        } else if (
            this.normalizeValue(source.city) &&
            this.normalizeValue(source.city) === this.normalizeValue(candidate.city)
        ) {
            score += 20;
        } else if (
            this.normalizeValue(source.country) &&
            this.normalizeValue(source.country) === this.normalizeValue(candidate.country)
        ) {
            score += 10;
        }

        if (source.religiousLevel === candidate.religiousLevel) {
            score += 20;
        } else {
            const religiousLevels = [
                ReligiousLevel.LIBERAL,
                ReligiousLevel.MODERATE,
                ReligiousLevel.PRACTICING,
                ReligiousLevel.VERY_PRACTICING,
            ];
            const sourceIndex = religiousLevels.indexOf(source.religiousLevel);
            const candidateIndex = religiousLevels.indexOf(candidate.religiousLevel);
            if (
                sourceIndex >= 0 &&
                candidateIndex >= 0 &&
                Math.abs(sourceIndex - candidateIndex) === 1
            ) {
                score += 12;
            } else {
                score += 6;
            }
        }

        if (
            this.normalizeValue(source.ethnicity) &&
            this.normalizeValue(source.ethnicity) === this.normalizeValue(candidate.ethnicity)
        ) {
            score += 15;
        } else if (this.hasNationalityOverlap(source, candidate)) {
            score += 10;
        } else {
            score += 5;
        }

        const familyValuesA = source.familyValues ?? [];
        const familyValuesB = candidate.familyValues ?? [];
        if (familyValuesA.length > 0 && familyValuesB.length > 0) {
            const overlap = this.getCommonInterests(familyValuesA, familyValuesB);
            score += Math.round(
                (overlap.length / Math.max(familyValuesA.length, familyValuesB.length)) * 10,
            );
        } else if (
            source.familyPlans &&
            candidate.familyPlans &&
            source.familyPlans === candidate.familyPlans
        ) {
            score += 10;
        } else if (source.familyPlans && candidate.familyPlans) {
            score += 5;
        }

        if (source.education && candidate.education) {
            if (source.education === candidate.education) {
                score += 5;
            } else {
                const educationLevels = [
                    EducationLevel.HIGH_SCHOOL,
                    EducationLevel.BACHELORS,
                    EducationLevel.MASTERS,
                    EducationLevel.DOCTORATE,
                    EducationLevel.ISLAMIC_STUDIES,
                    EducationLevel.OTHER,
                ];
                const sourceIndex = educationLevels.indexOf(source.education);
                const candidateIndex = educationLevels.indexOf(candidate.education);
                if (
                    sourceIndex >= 0 &&
                    candidateIndex >= 0 &&
                    Math.abs(sourceIndex - candidateIndex) <= 1
                ) {
                    score += 3;
                } else {
                    score += 2;
                }
            }
        }

        let lifestyleMatches = 0;
        let lifestyleChecks = 0;
        if (source.dietary && candidate.dietary) {
            lifestyleChecks++;
            if (source.dietary === candidate.dietary) lifestyleMatches++;
        }
        if (source.alcohol && candidate.alcohol) {
            lifestyleChecks++;
            if (source.alcohol === candidate.alcohol) lifestyleMatches++;
        }
        if (source.sleepSchedule && candidate.sleepSchedule) {
            lifestyleChecks++;
            if (source.sleepSchedule === candidate.sleepSchedule) lifestyleMatches++;
        }
        score += lifestyleChecks > 0 ? Math.round((lifestyleMatches / lifestyleChecks) * 5) : 2;

        if (sourceVerified && candidateVerified) {
            score = Math.round(score * 1.05);
        }
        if (source.isComplete && candidate.isComplete) {
            score = Math.round(score * 1.03);
        }

        return Math.max(0, Math.min(100, score));
    }

    private calculateDistanceKm(source: Profile, candidate: Profile): number | null {
        if (!source.latitude || !source.longitude || !candidate.latitude || !candidate.longitude) {
            return null;
        }

        const lat1 = Number(source.latitude);
        const lon1 = Number(source.longitude);
        const lat2 = Number(candidate.latitude);
        const lon2 = Number(candidate.longitude);
        const earthRadiusKm = 6371;
        const dLat = this.toRadians(lat2 - lat1);
        const dLon = this.toRadians(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.toRadians(lat1)) *
                Math.cos(this.toRadians(lat2)) *
                Math.sin(dLon / 2) *
                Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return earthRadiusKm * c;
    }

    private toRadians(value: number): number {
        return value * (Math.PI / 180);
    }

    private hasNationalityOverlap(source: Profile, candidate: Profile): boolean {
        const sourceNationalities = [source.nationality, ...(source.nationalities ?? [])]
            .map((value) => this.normalizeValue(value))
            .filter(Boolean);
        const candidateNationalities = [candidate.nationality, ...(candidate.nationalities ?? [])]
            .map((value) => this.normalizeValue(value))
            .filter(Boolean);
        return sourceNationalities.some((value) => candidateNationalities.includes(value));
    }

    private getCommonInterests(
        source: string[] | null | undefined,
        candidate: string[] | null | undefined,
    ): string[] {
        const sourceValues = (source ?? [])
            .map((value) => this.normalizeValue(value))
            .filter(Boolean);
        const candidateValues = (candidate ?? [])
            .map((value) => this.normalizeValue(value))
            .filter(Boolean);
        const candidateSet = new Set(candidateValues);
        return sourceValues.filter(
            (value, index) => candidateSet.has(value) && sourceValues.indexOf(value) === index,
        );
    }

    private normalizeValue(value: string | null | undefined): string {
        return (value ?? '').trim().toLowerCase();
    }

    private buildSearchCacheKey(userId: string, filters: SearchFiltersDto): string {
        const { forceRefresh, ...rawFilters } = filters as SearchFiltersDto & {
            forceRefresh?: boolean;
        };

        const normalized = this.normalizeFilterPayload(rawFilters as Record<string, any>);
        return `search:${userId}:${JSON.stringify(normalized)}`;
    }

    private normalizeFilterPayload(input: unknown): unknown {
        if (input == null) {
            return null;
        }

        if (Array.isArray(input)) {
            const normalizedValues = input
                .map((item) => this.normalizeFilterPayload(item))
                .filter((item) => item !== null && item !== undefined && item !== '');

            if (normalizedValues.every((item) => typeof item === 'string')) {
                return Array.from(
                    new Set((normalizedValues as string[]).map((item) => item.trim().toLowerCase())),
                ).sort();
            }

            return normalizedValues;
        }

        if (typeof input === 'object') {
            const record = input as Record<string, any>;
            const sortedKeys = Object.keys(record).sort();
            const normalizedRecord: Record<string, unknown> = {};

            for (const key of sortedKeys) {
                const value = this.normalizeFilterPayload(record[key]);
                if (value === undefined || value === null || value === '') {
                    continue;
                }
                normalizedRecord[key] = value;
            }

            return normalizedRecord;
        }

        if (typeof input === 'string') {
            const trimmed = input.trim();
            return trimmed.length > 0 ? trimmed.toLowerCase() : '';
        }

        return input;
    }

    private normalizeCommunicationStyle(value: string | null | undefined): string {
        const normalized = this.normalizeValue(value);
        switch (normalized) {
            case 'chatty_cathy':
            case 'storyteller':
            case 'expressive':
                return 'expressive';
            case 'listener':
            case 'deep_thinker':
            case 'reserved':
                return 'reserved';
            case 'joker':
            case 'sarcastic_wit':
            case 'humorous':
                return 'humorous';
            case 'easygoing':
            case 'gentle':
                return 'gentle';
            case 'straight_shooter':
            case 'direct':
                return 'direct';
            default:
                return normalized;
        }
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

    private isViewerGalleryRestricted(currentProfile: Profile | null): boolean {
        const viewer = currentProfile?.user as User | undefined;
        const isVerified = viewer?.selfieVerified === true;
        const isPremium = this.hasActivePremiumEntitlement(viewer);

        // Policy: free + non-verified viewers can only access the main profile photo.
        return !isVerified && !isPremium;
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
            lockReason: 'Verify your profile or upgrade to Premium to unlock all photos',
            unlockCta: 'Verify your profile or upgrade to Premium',
        }));

        return [unlockedMain, ...lockedPlaceholders];
    }

    private async getCachedBlockedIds(userId: string): Promise<string[]> {
        const cacheKey = `blocked_ids:${userId}`;
        const cached = await this.redisService.getJson<string[]>(cacheKey);
        if (cached) return cached;

        const blockedUsers = await this.blockedUserRepository.find({
            where: [{ blockerId: userId }, { blockedId: userId }],
            select: ['blockerId', 'blockedId'],
        });
        const ids = blockedUsers.map((blockedUser) =>
            blockedUser.blockerId === userId ? blockedUser.blockedId : blockedUser.blockerId,
        );
        await this.redisService.setJson(cacheKey, ids, 120);
        return ids;
    }

    private withPassportCountryOverride(
        filters: SearchFiltersDto,
        viewer: User | undefined,
    ): SearchFiltersDto {
        const passport = this.extractPassportLocation(viewer);
        if (!passport || !passport.country) {
            return filters;
        }

        return {
            ...filters,
            country: passport.country,
            goGlobal: true,
            maxDistance: undefined,
        } as SearchFiltersDto;
    }

    private resolveEffectiveProfileLocation(profile: Profile): Profile {
        const passport = this.extractPassportLocation(
            profile.user as unknown as Record<string, unknown> | undefined,
        );
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
            | {
                  isPassportActive?: boolean | null;
                  passportLocation?: unknown;
              }
            | undefined
            | null,
    ): {
        latitude?: number;
        longitude?: number;
        city?: string;
        country?: string;
    } | null {
        if (!user || user.isPassportActive !== true || !user.passportLocation) {
            return null;
        }

        const location = user.passportLocation as Record<string, unknown>;
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
        user:
            | {
                  id?: string | null;
                  isGhostModeEnabled?: boolean | null;
              }
            | undefined,
        viewerId: string,
    ): boolean {
        if (!user) return false;
        return user.isGhostModeEnabled === true && user.id !== viewerId;
    }

    private resolvePhotoVariants(originalUrl: string): {
        originalUrl: string;
        thumbnailUrl: string;
        cardUrl: string;
        profileUrl: string;
        fullscreenUrl: string;
    } {
        const cloudinaryStatic = CloudinaryService as unknown as {
            buildImageUrls?: (url: string) => {
                originalUrl?: string;
                thumbnailUrl?: string;
                cardUrl?: string;
                profileUrl?: string;
                fullscreenUrl?: string;
            };
        };

        const variants = cloudinaryStatic.buildImageUrls?.(originalUrl);
        if (variants) {
            return {
                originalUrl: variants.originalUrl ?? originalUrl,
                thumbnailUrl: variants.thumbnailUrl ?? originalUrl,
                cardUrl: variants.cardUrl ?? originalUrl,
                profileUrl: variants.profileUrl ?? originalUrl,
                fullscreenUrl: variants.fullscreenUrl ?? originalUrl,
            };
        }

        return {
            originalUrl,
            thumbnailUrl: originalUrl,
            cardUrl: originalUrl,
            profileUrl: originalUrl,
            fullscreenUrl: originalUrl,
        };
    }

    private readBooleanFlag(
        source: Record<string, unknown> | undefined,
        key: string,
    ): boolean {
        if (!source || typeof source !== 'object') {
            return false;
        }
        return source[key] === true;
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

    private calculateAge(dateOfBirth: Date): number {
        const today = new Date();
        const birth = new Date(dateOfBirth);
        let age = today.getFullYear() - birth.getFullYear();
        const monthDelta = today.getMonth() - birth.getMonth();
        if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birth.getDate())) {
            age--;
        }
        return age;
    }
}

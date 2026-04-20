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

type SearchDeckEntry = {
    userId: string;
    compatibilityScore: number;
    commonInterests: string[];
    distanceKm: number | null;
    lastActiveAt: number;
};

type SearchUserPayload = Record<string, any>;
type HotDeckPayloadMap = Record<string, SearchUserPayload>;

type SearchCursorPayload = {
    offset: number;
};

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

    // ─── OPTIMIZED FOR FAST RANKING ───────────────────────
    private static readonly DISCOVERY_PROFILE_SELECT = [
        'profile.id',
        'profile.userId',
        'profile.bio',
        'profile.gender',
        'profile.dateOfBirth',
        'profile.maritalStatus',
        'profile.religiousLevel',
        'profile.ethnicity',
        'profile.nationality',
        'profile.nationalities',
        'profile.sect',
        'profile.prayerFrequency',
        'profile.dietary',
        'profile.alcohol',
        'profile.hijabStatus',
        'profile.company',
        'profile.familyValues',
        'profile.height',
        'profile.weight',
        'profile.livingSituation',
        'profile.jobTitle',
        'profile.education',
        'profile.educationDetails',
        'profile.familyPlans',
        'profile.communicationStyle',
        'profile.marriageIntention',
        'profile.secondWifePreference',
        'profile.intentMode',
        'profile.workoutFrequency',
        'profile.sleepSchedule',
        'profile.socialMediaUsage',
        'profile.hasPets',
        'profile.petPreference',
        'profile.interests',
        'profile.languages',
        'profile.hasChildren',
        'profile.numberOfChildren',
        'profile.wantsChildren',
        'profile.willingToRelocate',
        'profile.city',
        'profile.country',
        'profile.latitude',
        'profile.longitude',
        'profile.aboutPartner',
        'profile.showAge',
        'profile.showDistance',
        'profile.showOnlineStatus',
        'profile.showLastSeen',
        'profile.profileCompletionPercentage',
        'profile.activityScore',
        'profile.isComplete',
        'profile.createdAt',
        'profile.updatedAt',
    ];

    // ─── MINIMAL FIELDS FOR RANKING (used during bulk candidate fetch) ───
    private static readonly DISCOVERY_PROFILE_RANK_SELECT = [
        'profile.id',
        'profile.userId',
        'profile.gender',
        'profile.dateOfBirth',
        'profile.religiousLevel',
        'profile.marriageIntention',
        'profile.intentMode',
        'profile.city',
        'profile.country',
        'profile.latitude',
        'profile.longitude',
        'profile.interests',
        'profile.ethnicity',
        'profile.nationality',
        'profile.maritalStatus',
        'profile.education',
        'profile.prayerFrequency',
        'profile.profileCompletionPercentage',
        'profile.activityScore',
        'profile.createdAt',
    ];

    private static readonly DISCOVERY_USER_SELECT = [
        'user.id',
        'user.username',
        'user.email',
        'user.firstName',
        'user.lastName',
        'user.phone',
        'user.role',
        'user.status',
        'user.emailVerified',
        'user.notificationsEnabled',
        'user.selfieVerified',
        'user.isPremium',
        'user.premiumStartDate',
        'user.premiumExpiryDate',
        'user.isGhostModeEnabled',
        'user.isPassportActive',
        'user.passportLocation',
        'user.backgroundCheckStatus',
        'user.isShadowBanned',
        'user.trustScore',
        'user.flagCount',
        'user.deviceCount',
        'user.lastLoginAt',
        'user.createdAt',
        'user.updatedAt',
    ];

    // ─── MINIMAL FIELDS FOR RANKING (used during bulk candidate fetch) ───
    private static readonly DISCOVERY_USER_RANK_SELECT = [
        'user.id',
        'user.firstName',
        'user.lastName',
        'user.selfieVerified',
        'user.isPremium',
        'user.premiumStartDate',
        'user.premiumExpiryDate',
        'user.isGhostModeEnabled',
        'user.isPassportActive',
        'user.passportLocation',
        'user.lastLoginAt',
        'user.status',
    ];

    async search(userId: string, filters: SearchFiltersDto) {
        this.logger.debug(
            `[Search] Starting search for userId=${userId}, filters=${JSON.stringify(filters)}`,
        );

        const limit = filters.limit ?? 20;
        const cursorOffset = this.parseDeckCursor(filters.cursor);
        const usesDeckCursor = cursorOffset !== null;
        const page = usesDeckCursor
            ? Math.floor(cursorOffset / Math.max(limit, 1)) + 1
            : filters.page ?? 1;
        const shouldIncludeDeckMeta = filters.includeDeckMeta === true || usesDeckCursor;
        const buildResponse = (
            users: unknown[],
            total: number,
            startOffset: number,
        ) =>
            this.buildSearchResponse({
                users,
                total,
                page,
                limit,
                startOffset,
                includeDeckMeta: shouldIncludeDeckMeta,
            });
        const cacheKey = this.buildSearchCacheKey(userId, filters);
        const hasExplicitExcludeIds = Array.isArray(filters.excludeIds)
            ? filters.excludeIds.some((id) => String(id ?? '').trim().length > 0)
            : false;

        if (!filters.forceRefresh && !hasExplicitExcludeIds) {
            try {
                const cached = await this.redisService.getJson<any>(cacheKey);
                if (cached) {
                    this.logger.debug(`[Search] Cache hit for userId=${userId}`);
                    return cached;
                }
            } catch (err) {
                this.logger.warn(
                    `[Search] Redis cache read failed, continuing without cache: ${err?.message}`,
                );
            }
        } else {
            try {
                await this.redisService.del(cacheKey);
            } catch (_) { }
        }

        if (!userId) {
            this.logger.error('[Search] No userId provided - returning empty results');
            return buildResponse([], 0, 0);
        }

        const explicitExcludeIds = Array.from(
            new Set(
                (filters.excludeIds ?? [])
                    .map((id) => id.trim())
                    .filter((id) => id.length > 0),
            ),
        ).slice(0, 1000);
        const startOffset = usesDeckCursor ? cursorOffset : (page - 1) * limit;
        const rawHotDeckCacheKey = this.buildHotDeckCacheKey(userId, filters);
        const rawHotDeckPayloadCacheKey = this.buildHotDeckPayloadCacheKey(userId, filters);

        if (!filters.forceRefresh) {
            const [cachedHotDeck, cachedHotDeckPayload] = await Promise.all([
                this.redisService.getJson<SearchDeckEntry[]>(rawHotDeckCacheKey).catch(() => null),
                this.redisService
                    .getJson<HotDeckPayloadMap>(rawHotDeckPayloadCacheKey)
                    .catch(() => null),
            ]);

            if (Array.isArray(cachedHotDeck) && cachedHotDeck.length > 0) {
                const exclusionSet = new Set([
                    userId,
                    ...explicitExcludeIds,
                ]);
                const filteredDeck = cachedHotDeck.filter(
                    (entry) => !exclusionSet.has(entry.userId),
                );
                const total = filteredDeck.length;
                const pagedDeck = filteredDeck.slice(startOffset, startOffset + limit);

                if (pagedDeck.length > 0) {
                    const cachedUsers = this.resolveUsersFromHotDeckPayload(
                        pagedDeck,
                        cachedHotDeckPayload,
                    );

                    if (cachedUsers) {
                        const response = buildResponse(cachedUsers, total, startOffset);
                        void this.redisService.setJson(cacheKey, response, 90).catch(() => undefined);
                        this.logger.debug(
                            `[Search] Served userId=${userId} from early hot deck payload cache`,
                        );
                        return response;
                    }
                }
            }
        }

        const [currentProfile, currentPreference] = await Promise.all([
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
            return buildResponse([], 0, 0);
        }

        const hasAdvancedFilterAccess = this.hasActivePremiumEntitlement(
            currentProfile.user as User | undefined,
        );
        const effectiveViewerProfile = hasAdvancedFilterAccess
            ? this.resolveEffectiveProfileLocation(currentProfile)
            : currentProfile;
        const passportAdjustedFilters = hasAdvancedFilterAccess
            ? this.withPassportCountryOverride(
                filters,
                currentProfile.user as User | undefined,
            )
            : filters;
        const effectiveFilters = this.applyFreeTierFilterLimits(
            passportAdjustedFilters,
            hasAdvancedFilterAccess,
        );
        const skipRelationshipExclusions =
            filters.forceRefresh &&
            explicitExcludeIds.length === 0 &&
            this.isFreshUserAccount(currentProfile.user as User | undefined);
        const hotDeckCacheKey = this.buildHotDeckCacheKey(userId, effectiveFilters);
        const hotDeckPayloadCacheKey = this.buildHotDeckPayloadCacheKey(
            userId,
            effectiveFilters,
        );
        const effectiveSortBy = effectiveFilters.sortBy ?? SearchSortBy.DISTANCE;

        const queryExcludeIds = [userId, ...explicitExcludeIds].filter(
            Boolean,
        );
        const activeCutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        const hasUserLocation = this.hasValidCoordinates(
            effectiveViewerProfile.latitude,
            effectiveViewerProfile.longitude,
        );
        const isCompatibilitySort = effectiveSortBy === SearchSortBy.COMPATIBILITY;
        const overfetchMultiplier = isCompatibilitySort ? 2.4 : 1.1;
        const minimumFetch = isCompatibilitySort ? 28 : 20;
        const maximumFetch = isCompatibilitySort ? 96 : 60;
        const candidateFetchLimit = Math.min(
            Math.max(Math.ceil(page * limit * overfetchMultiplier), minimumFetch),
            maximumFetch,
        );

        if (!filters.forceRefresh) {
            const [cachedHotDeck, cachedHotDeckPayload, blockedIds, dynamicExcludedIds] = await Promise.all([
                this.redisService.getJson<SearchDeckEntry[]>(hotDeckCacheKey),
                this.redisService
                    .getJson<HotDeckPayloadMap>(hotDeckPayloadCacheKey)
                    .catch(() => null),
                this.getCachedBlockedIds(userId).catch((err) => {
                    this.logger.warn(
                        `[Search] Failed to get blocked IDs for hot deck, continuing: ${err?.message}`,
                    );
                    return [] as string[];
                }),
                this.getCachedInteractionExclusionIds(userId).catch((err) => {
                    this.logger.warn(
                        `[Search] Failed to get interaction exclusions for hot deck, continuing: ${err?.message}`,
                    );
                    return [] as string[];
                }),
            ]);

            if (Array.isArray(cachedHotDeck) && cachedHotDeck.length > 0) {
                const exclusionSet = new Set([
                    ...queryExcludeIds,
                    ...blockedIds,
                    ...dynamicExcludedIds,
                ]);
                const filteredDeck = cachedHotDeck.filter(
                    (entry) => !exclusionSet.has(entry.userId),
                );
                const total = filteredDeck.length;
                const start = usesDeckCursor ? cursorOffset : (page - 1) * limit;
                const pagedDeck = filteredDeck.slice(start, start + limit);

                if (pagedDeck.length > 0) {
                    const cachedUsers = this.resolveUsersFromHotDeckPayload(
                        pagedDeck,
                        cachedHotDeckPayload,
                    );

                    if (cachedUsers) {
                        const response = buildResponse(cachedUsers, total, start);
                        await this.redisService.setJson(cacheKey, response, 90).catch(() => undefined);
                        this.logger.debug(
                            `[Search] Served userId=${userId} from hot deck payload cache`,
                        );
                        return response;
                    }

                    const restrictGalleryForViewer = this.isViewerGalleryRestricted(currentProfile);
                    const users = await this.buildUsersFromDeckEntries(
                        pagedDeck,
                        effectiveViewerProfile,
                        restrictGalleryForViewer,
                        userId,
                    );
                    const mergedPayload = this.mergeHotDeckPayload(
                        cachedHotDeckPayload,
                        users,
                    );
                    await this.redisService
                        .setJson(hotDeckPayloadCacheKey, mergedPayload, 120)
                        .catch(() => undefined);

                    const response = buildResponse(users, total, start);

                    await this.redisService.setJson(cacheKey, response, 90).catch(() => undefined);
                    this.logger.debug(`[Search] Served userId=${userId} from hot deck cache`);
                    return response;
                }
            }
        }

        const query = this.profileRepository
            .createQueryBuilder('profile')
            .leftJoinAndSelect('profile.user', 'user');

        // Compute effective coordinates ONCE via CROSS JOIN LATERAL.
        // This replaces all inline CASE/regex/CAST duplication — coords.effective_lat
        // and coords.effective_lng are available for use anywhere in the query.
        this.addEffectiveCoordinatesJoin(query);

        query
            .select([
                ...SearchService.DISCOVERY_PROFILE_RANK_SELECT,
                ...SearchService.DISCOVERY_USER_RANK_SELECT,
            ])
            .where(
                queryExcludeIds.length > 0
                    ? 'profile.userId NOT IN (:...excludeIds)'
                    : '1=1',
                { excludeIds: queryExcludeIds.length > 0 ? queryExcludeIds : ['__none__'] },
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

        if (!skipRelationshipExclusions) {
            query.andWhere(
                (qb) => {
                    const subQuery = qb
                        .subQuery()
                        .select('1')
                        .from(Like, 'swipe_like')
                        .where('swipe_like.likerId = :userId')
                        .andWhere('swipe_like.likedId = profile.userId')
                        .andWhere('swipe_like.isLike = :positiveLike')
                        .getQuery();
                    return `NOT EXISTS ${subQuery}`;
                },
                { userId, positiveLike: true },
            )
            .andWhere(
                (qb) => {
                    const subQuery = qb
                        .subQuery()
                        .select('1')
                        .from(BlockedUser, 'blocked_user')
                        .where(
                            '((blocked_user.blockerId = :userId AND blocked_user.blockedId = profile.userId) OR (blocked_user.blockedId = :userId AND blocked_user.blockerId = profile.userId))',
                        )
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
            );
        }

        this.applyGenderFilter(query, effectiveFilters, effectiveViewerProfile, currentPreference);
        this.applyExplicitFilters(query, effectiveFilters, effectiveViewerProfile, hasUserLocation);
        this.applySavedPreferenceFilters(
            query,
            currentPreference,
            effectiveViewerProfile,
            hasUserLocation,
            effectiveFilters,
        );

        // Always compute distance when user has location (needed for ranking + response).
        // Uses pre-computed coords.effective_lat / coords.effective_lng from the LATERAL join.
        if (hasUserLocation) {
            query.addSelect(
                this.buildDistanceSql('orderLat', 'orderLng'),
                'distance',
            );
            query.setParameter('orderLat', effectiveViewerProfile.latitude);
            query.setParameter('orderLng', effectiveViewerProfile.longitude);
        }

        // SQL-level ordering depends on sortBy
        if (effectiveSortBy === SearchSortBy.DISTANCE && hasUserLocation) {
            query.orderBy('distance', 'ASC', 'NULLS LAST');
        } else if (effectiveSortBy === SearchSortBy.NEWEST) {
            query.orderBy('profile.createdAt', 'DESC');
        } else if (effectiveSortBy === SearchSortBy.ACTIVITY) {
            query.orderBy('profile.activityScore', 'DESC');
        } else {
            // COMPATIBILITY or default — use activity as initial SQL sort,
            // then re-rank in-memory by compatibility
            if (hasUserLocation) {
                query.orderBy('distance', 'ASC', 'NULLS LAST');
            } else {
                query.orderBy('profile.activityScore', 'DESC');
            }
        }

        query.take(candidateFetchLimit);

        let candidateProfiles: Profile[];
        try {
            candidateProfiles = await query.getMany();
        } catch (error: any) {
            this.logger.error(
                `[Search] Candidate query failed: code=${error?.code ?? error?.driverError?.code ?? 'unknown'} position=${error?.position ?? error?.driverError?.position ?? 'unknown'}`,
            );
            throw error;
        }
        if (candidateProfiles.length === 0) {
            const emptyResponse = buildResponse([], 0, 0);
            try {
                await this.redisService.setJson(cacheKey, emptyResponse, 180);
            } catch (_) { }
            return emptyResponse;
        }

        const candidateUserIds = candidateProfiles.map((profile) => profile.userId);
        const shouldApplyReciprocalPreferenceFilter =
            effectiveSortBy === SearchSortBy.COMPATIBILITY;
        const candidatePreferences = shouldApplyReciprocalPreferenceFilter && candidateUserIds.length > 0
            ? await this.userPreferenceRepository
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
            : [];

        const candidatePreferenceMap = new Map(
            candidatePreferences.map((preference) => [preference.userId, preference]),
        );
        const restrictGalleryForViewer = this.isViewerGalleryRestricted(
            currentProfile,
        );

        const preSortedCandidates = candidateProfiles
            .filter((candidate) =>
                this.matchesPreference(
                    currentPreference,
                    this.resolveEffectiveProfileLocation(candidate),
                    effectiveViewerProfile,
                ),
            )
            .filter((candidate) => {
                if (!shouldApplyReciprocalPreferenceFilter) {
                    return true;
                }

                return this.matchesPreference(
                    candidatePreferenceMap.get(candidate.userId),
                    effectiveViewerProfile,
                    this.resolveEffectiveProfileLocation(candidate),
                );
            })
            .map((candidate) => {
                const effectiveCandidateProfile = this.resolveEffectiveProfileLocation(candidate);
                const maskedByGhost = this.shouldMaskGhostProfile(
                    candidate.user as User | undefined,
                    userId,
                );
                const shouldComputeCompatibility =
                    effectiveSortBy === SearchSortBy.COMPATIBILITY;
                const compatibilityScore = shouldComputeCompatibility
                    ? this.computeCompatibility(
                          effectiveViewerProfile,
                          effectiveCandidateProfile,
                          effectiveViewerProfile.user?.selfieVerified ?? false,
                          candidate.user?.selfieVerified ?? false,
                      )
                    : 0;
                const commonInterests = shouldComputeCompatibility
                    ? this.getCommonInterests(
                          effectiveViewerProfile.interests,
                          effectiveCandidateProfile.interests,
                      )
                    : [];
                const distanceKm = this.calculateDistanceKm(
                    effectiveViewerProfile,
                    effectiveCandidateProfile,
                );
                const lastActiveAt = candidate.user?.lastLoginAt
                    ? new Date(candidate.user.lastLoginAt).getTime()
                    : 0;

                return {
                    profile: effectiveCandidateProfile,
                    maskedByGhost,
                    compatibilityScore,
                    commonInterests,
                    distanceKm,
                    lastActiveAt,
                };
            });

        const rankedCandidates = (
            effectiveSortBy === SearchSortBy.DISTANCE && hasUserLocation
                ? preSortedCandidates.filter((candidate) => candidate.distanceKm != null)
                : preSortedCandidates
        ).sort((a, b) => {
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
                    if ((b.profile.activityScore ?? 0) !== (a.profile.activityScore ?? 0)) {
                        return (b.profile.activityScore ?? 0) - (a.profile.activityScore ?? 0);
                    }
                    return a.profile.userId.localeCompare(b.profile.userId);
                }

                if (effectiveSortBy === SearchSortBy.NEWEST) {
                    const dateA = a.profile.createdAt?.getTime() ?? 0;
                    const dateB = b.profile.createdAt?.getTime() ?? 0;
                    if (dateB !== dateA) return dateB - dateA;
                    const distA = a.distanceKm ?? Infinity;
                    const distB = b.distanceKm ?? Infinity;
                    if (distA !== distB) return distA - distB;
                    return a.profile.userId.localeCompare(b.profile.userId);
                }

                if (effectiveSortBy === SearchSortBy.ACTIVITY) {
                    if ((b.profile.activityScore ?? 0) !== (a.profile.activityScore ?? 0)) {
                        return (b.profile.activityScore ?? 0) - (a.profile.activityScore ?? 0);
                    }
                    const distA = a.distanceKm ?? Infinity;
                    const distB = b.distanceKm ?? Infinity;
                    if (distA !== distB) return distA - distB;
                    return a.profile.userId.localeCompare(b.profile.userId);
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
                if ((b.profile.activityScore ?? 0) !== (a.profile.activityScore ?? 0)) {
                    return (b.profile.activityScore ?? 0) - (a.profile.activityScore ?? 0);
                }
                return a.profile.userId.localeCompare(b.profile.userId);
            });

        const hotDeckEntries: SearchDeckEntry[] = rankedCandidates
            .slice(0, Math.max(limit * 8, 120))
            .map((candidate) => ({
                userId: candidate.profile.userId,
                compatibilityScore: candidate.compatibilityScore,
                commonInterests: candidate.commonInterests,
                distanceKm: candidate.distanceKm,
                lastActiveAt: candidate.lastActiveAt,
            }));

        const shouldPersistHotDeck = explicitExcludeIds.length === 0;
        const globalHotDeckKeys = Array.from(
            new Set([
                this.buildGlobalHotDeckCacheKey(filters),
                this.buildGlobalHotDeckCacheKey(effectiveFilters),
            ]),
        );
        const globalHotDeckPayloadKeys = Array.from(
            new Set([
                this.buildGlobalHotDeckPayloadCacheKey(filters),
                this.buildGlobalHotDeckPayloadCacheKey(effectiveFilters),
            ]),
        );

        if (shouldPersistHotDeck) {
            void this.redisService
                .setJson(hotDeckCacheKey, hotDeckEntries, 120)
                .catch(() => undefined);
            void Promise.all(
                globalHotDeckKeys.map((key) =>
                    this.redisService.setJson(key, hotDeckEntries, 120).catch(() => undefined),
                ),
            ).catch(() => undefined);
        }

        const total = rankedCandidates.length;
        const start = usesDeckCursor ? cursorOffset : (page - 1) * limit;
        const pagedUsers = rankedCandidates.slice(start, start + limit);
        const pagedUserIds = pagedUsers.map(({ profile }) => profile.userId);

        const [pagePhotos, onlineUsers] = await Promise.all([
            pagedUserIds.length > 0
                ? this.photoRepository
                      .createQueryBuilder('photo')
                      .select([
                          'photo.id',
                          'photo.userId',
                          'photo.url',
                          'photo.publicId',
                          'photo.isMain',
                          'photo.isSelfieVerification',
                          'photo.order',
                          'photo.moderationStatus',
                          'photo.moderationNote',
                          'photo.createdAt',
                      ])
                      .where('photo.userId IN (:...pagedUserIds)', { pagedUserIds })
                      .andWhere('photo.moderationStatus = :approvedStatus', {
                          approvedStatus: PhotoModerationStatus.APPROVED,
                      })
                      .orderBy('photo.isMain', 'DESC')
                      .addOrderBy('photo.order', 'ASC')
                      .getMany()
                : Promise.resolve([]),
            this.redisService.getOnlineUsers().catch((err) => {
                this.logger.warn(`[Search] Failed to fetch online users: ${err?.message}`);
                return [] as string[];
            }),
        ]);

        const photosMap = new Map<string, any[]>();
        for (const photo of pagePhotos) {
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

        const users = pagedUsers.map(
            ({
                profile,
                maskedByGhost,
                compatibilityScore,
                commonInterests,
                distanceKm,
            }) => {
                const candidatePhotos = this.applyViewerPhotoAccessPolicy(
                    photosMap.get(profile.userId) ?? [],
                    profile.userId,
                    restrictGalleryForViewer,
                );
                const profilePhotos = maskedByGhost
                    ? this.applyGhostPhotoMask(candidatePhotos, profile.userId)
                    : candidatePhotos;

                return {
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
                };
            },
        );

        if (shouldPersistHotDeck) {
            const hotDeckPayload = this.mergeHotDeckPayload(null, users);
            void this.redisService
                .setJson(hotDeckPayloadCacheKey, hotDeckPayload, 120)
                .catch(() => undefined);
            void Promise.all(
                globalHotDeckPayloadKeys.map((key) =>
                    this.redisService.setJson(key, hotDeckPayload, 120).catch(() => undefined),
                ),
            ).catch(() => undefined);
        }

        const response = buildResponse(users, total, start);

        void this.redisService
            .setJson(cacheKey, response, 180)
            .catch((err) => {
                this.logger.warn(
                    `[Search] Redis cache write failed, continuing: ${err?.message}`,
                );
            });

        this.logger.debug(
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

    /**
     * Adds a CROSS JOIN LATERAL subquery that computes effective coordinates
     * exactly ONCE per row. The computed columns are:
     *   coords.effective_lat  (passport lat if active+valid, else profile lat)
     *   coords.effective_lng  (passport lng if active+valid, else profile lng)
     *
     * The effective coordinates use the normalized numeric columns
     * `user.passportLatitude` / `user.passportLongitude` which are maintained
     * at write-time by the backend. There is NO regex, NO JSON extraction,
     * and NO nested CASE inside the query.
     *
     * Single CASE per axis, references indexed numeric columns.
     *
     * Must be called AFTER `.leftJoinAndSelect('profile.user', 'user')` so that
     * "user" and "profile" aliases are in scope for the LATERAL subquery.
     */
    private addEffectiveCoordinatesJoin(query: SelectQueryBuilder<Profile>): void {
        const lateralSql = `
            LATERAL (
                SELECT
                    CASE
                        WHEN "user"."isPassportActive" = true
                            AND "user"."passportLatitude" IS NOT NULL
                        THEN "user"."passportLatitude"
                        ELSE CAST("profile"."latitude" AS double precision)
                    END AS effective_lat,
                    CASE
                        WHEN "user"."isPassportActive" = true
                            AND "user"."passportLongitude" IS NOT NULL
                        THEN "user"."passportLongitude"
                        ELSE CAST("profile"."longitude" AS double precision)
                    END AS effective_lng
            )
        `;

        // Use innerJoin with raw LATERAL expression. TypeORM emits:
        //   INNER JOIN LATERAL (...) coords ON TRUE
        query.innerJoin(lateralSql, 'coords', 'TRUE');
    }

    /**
     * Applies a distance constraint using pre-computed effective coordinates.
     * Uses a two-stage filter:
     * 1. Bounding box on profile columns (index-friendly pre-filter)
     * 2. Precise Haversine distance using coords.effective_lat / coords.effective_lng
     *
     * No inline CASE/regex/CAST — all coordinate logic lives in the LATERAL join.
     */
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

        // Stage 1: Bounding box on profile coordinates (uses indexes, fast pre-filter)
        query.andWhere(
            `(CAST("profile"."latitude" AS double precision) BETWEEN :${prefix}MinLat AND :${prefix}MaxLat AND CAST("profile"."longitude" AS double precision) BETWEEN :${prefix}MinLng AND :${prefix}MaxLng)`,
            {
                [`${prefix}MinLat`]: latitude - latDelta,
                [`${prefix}MaxLat`]: latitude + latDelta,
                [`${prefix}MinLng`]: longitude - lngDelta,
                [`${prefix}MaxLng`]: longitude + lngDelta,
            },
        );

        // Stage 2: Precise Haversine distance using pre-computed effective coordinates
        const distanceExpr = this.buildDistanceSql(`${prefix}UserLat`, `${prefix}UserLng`);

        query.andWhere(
            `(${distanceExpr} <= :${prefix}MaxDistance)`,
            {
                [`${prefix}UserLat`]: latitude,
                [`${prefix}UserLng`]: longitude,
                [`${prefix}MaxDistance`]: maxDistance,
            },
        );
    }

    /**
     * Builds the Haversine distance SQL using pre-computed coordinate aliases
     * (coords.effective_lat, coords.effective_lng). These are produced by the
     * LATERAL join added via `addEffectiveCoordinatesJoin()`.
     *
     * acos input is clamped between -1 and 1 to prevent NaN from floating-point
     * rounding errors.
     */
    private buildDistanceSql(latitudeParam: string, longitudeParam: string): string {
        return `(6371 * acos(LEAST(1.0, GREATEST(-1.0, ` +
            `cos(radians(:${latitudeParam})) * cos(radians(coords.effective_lat)) ` +
            `* cos(radians(coords.effective_lng) - radians(:${longitudeParam})) ` +
            `+ sin(radians(:${latitudeParam})) * sin(radians(coords.effective_lat))` +
            `))))`;
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

        if (
            preference.maxDistance &&
            this.hasValidCoordinates(referenceProfile.latitude, referenceProfile.longitude)
        ) {
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
        if (
            !this.hasValidCoordinates(source.latitude, source.longitude) ||
            !this.hasValidCoordinates(candidate.latitude, candidate.longitude)
        ) {
            return null;
        }

        const lat1 = Number(source.latitude);
        const lon1 = Number(source.longitude);
        const lat2 = Number(candidate.latitude);
        const lon2 = Number(candidate.longitude);
        if (
            !Number.isFinite(lat1) ||
            !Number.isFinite(lon1) ||
            !Number.isFinite(lat2) ||
            !Number.isFinite(lon2)
        ) {
            return null;
        }
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

    private hasValidCoordinates(latitude: unknown, longitude: unknown): boolean {
        const lat = Number(latitude);
        const lng = Number(longitude);

        return (
            Number.isFinite(lat) &&
            Number.isFinite(lng) &&
            lat >= -90 &&
            lat <= 90 &&
            lng >= -180 &&
            lng <= 180 &&
            !(lat === 0 && lng === 0)
        );
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

    private isFreshUserAccount(user: User | null | undefined): boolean {
        if (!user?.createdAt) {
            return false;
        }

        const createdAtMs = new Date(user.createdAt).getTime();
        if (!Number.isFinite(createdAtMs)) {
            return false;
        }

        return Date.now() - createdAtMs <= 30 * 60 * 1000;
    }

    private buildHotDeckCacheKey(userId: string, filters: SearchFiltersDto): string {
        const {
            forceRefresh,
            excludeIds,
            page,
            limit,
            cursor,
            includeDeckMeta,
            ...baseFilters
        } = filters as SearchFiltersDto & {
            forceRefresh?: boolean;
            excludeIds?: string[];
            page?: number;
            limit?: number;
            cursor?: string;
            includeDeckMeta?: boolean;
        };
        const normalized = this.normalizeFilterPayload(baseFilters);
        return `search_hot:${userId}:${JSON.stringify(normalized)}`;
    }

    private buildHotDeckPayloadCacheKey(userId: string, filters: SearchFiltersDto): string {
        return `${this.buildHotDeckCacheKey(userId, filters)}:payload`;
    }

    private buildGlobalHotDeckCacheKey(filters: SearchFiltersDto): string {
        const {
            forceRefresh,
            excludeIds,
            page,
            limit,
            cursor,
            includeDeckMeta,
            ...baseFilters
        } = filters as SearchFiltersDto & {
            forceRefresh?: boolean;
            excludeIds?: string[];
            page?: number;
            limit?: number;
            cursor?: string;
            includeDeckMeta?: boolean;
        };

        const normalized = this.normalizeFilterPayload(baseFilters);
        return `search_hot_global:${JSON.stringify(normalized)}`;
    }

    private buildGlobalHotDeckPayloadCacheKey(filters: SearchFiltersDto): string {
        return `${this.buildGlobalHotDeckCacheKey(filters)}:payload`;
    }

    private resolveUsersFromHotDeckPayload(
        entries: SearchDeckEntry[],
        payloadMap: HotDeckPayloadMap | null,
    ): SearchUserPayload[] | null {
        if (!payloadMap) {
            return null;
        }

        const users: SearchUserPayload[] = [];
        for (const entry of entries) {
            const cachedUser = payloadMap[entry.userId];
            if (!cachedUser) {
                return null;
            }

            users.push({
                ...cachedUser,
                compatibilityScore: entry.compatibilityScore,
                commonInterests: entry.commonInterests,
                distanceKm: entry.distanceKm ?? cachedUser.distanceKm ?? null,
            });
        }

        return users;
    }

    private mergeHotDeckPayload(
        existing: HotDeckPayloadMap | null,
        users: SearchUserPayload[],
    ): HotDeckPayloadMap {
        const merged: HotDeckPayloadMap = {
            ...(existing ?? {}),
        };

        for (const user of users) {
            const userId = String(user?.id ?? '').trim();
            if (!userId) {
                continue;
            }

            merged[userId] = {
                ...user,
            };
        }

        return merged;
    }

    private parseDeckCursor(cursor: string | undefined): number | null {
        const rawCursor = cursor?.trim();
        if (!rawCursor) {
            return null;
        }

        try {
            const decoded = Buffer.from(rawCursor, 'base64url').toString('utf8');
            const parsed = JSON.parse(decoded) as SearchCursorPayload;
            const offset = Number(parsed?.offset);
            if (!Number.isFinite(offset) || offset < 0) {
                return null;
            }
            return Math.floor(offset);
        } catch {
            return null;
        }
    }

    private buildDeckCursor(offset: number): string {
        const payload: SearchCursorPayload = {
            offset: Math.max(0, Math.floor(offset)),
        };
        return Buffer.from(JSON.stringify(payload)).toString('base64url');
    }

    private buildSearchResponse({
        users,
        total,
        page,
        limit,
        startOffset,
        includeDeckMeta,
    }: {
        users: unknown[];
        total: number;
        page: number;
        limit: number;
        startOffset: number;
        includeDeckMeta: boolean;
    }): {
        users: unknown[];
        total: number;
        page: number;
        limit: number;
        hasMore?: boolean;
        nextCursor?: string | null;
    } {
        const response: {
            users: unknown[];
            total: number;
            page: number;
            limit: number;
            hasMore?: boolean;
            nextCursor?: string | null;
        } = {
            users,
            total,
            page,
            limit,
        };

        if (includeDeckMeta) {
            const consumed = startOffset + users.length;
            const hasMore = consumed < total;
            response.hasMore = hasMore;
            response.nextCursor = hasMore ? this.buildDeckCursor(consumed) : null;
        }

        return response;
    }

    private buildSearchCacheKey(userId: string, filters: SearchFiltersDto): string {
        const { forceRefresh, ...rawFilters } = filters as SearchFiltersDto & {
            forceRefresh?: boolean;
        };

        const cacheFilterPayload: Record<string, unknown> = {
            ...(rawFilters as Record<string, unknown>),
        };

        if (Array.isArray(cacheFilterPayload.excludeIds)) {
            const normalizedExcludeIds = Array.from(
                new Set(
                    (cacheFilterPayload.excludeIds as unknown[])
                        .map((value) => String(value ?? '').trim())
                        .filter((value) => value.length > 0),
                ),
            ).sort();

            cacheFilterPayload.excludeIds =
                normalizedExcludeIds.length > 0
                    ? `set:${this.hashString(normalizedExcludeIds.join(','))}:${normalizedExcludeIds.length}`
                    : undefined;
        }

        const normalized = this.normalizeFilterPayload(cacheFilterPayload);
        return `search:${userId}:${JSON.stringify(normalized)}`;
    }

    private hashString(value: string): string {
        let hash = 2166136261;
        for (let index = 0; index < value.length; index++) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
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

    private async getCachedInteractionExclusionIds(userId: string): Promise<string[]> {
        const cacheKey = `interaction_exclusions:${userId}`;
        const cached = await this.redisService.getJson<string[]>(cacheKey);
        if (cached) return cached;

        const [likes, matches] = await Promise.all([
            this.likeRepository.find({
                where: { likerId: userId, isLike: true },
                select: ['likedId'],
            }),
            this.matchRepository
                .createQueryBuilder('match')
                .select(['match.user1Id', 'match.user2Id'])
                .where('match.status = :status', { status: MatchStatus.ACTIVE })
                .andWhere(
                    '(match.user1Id = :userId OR match.user2Id = :userId)',
                    { userId },
                )
                .getMany(),
        ]);

        const matchedPartnerIds = matches
            .map((match) =>
                match.user1Id === userId ? match.user2Id : match.user1Id,
            )
            .filter(Boolean);

        const ids = Array.from(
            new Set([
                ...likes.map((like) => like.likedId),
                ...matchedPartnerIds,
            ]),
        );

        await this.redisService.setJson(cacheKey, ids, 20);
        return ids;
    }

    private async buildUsersFromDeckEntries(
        entries: SearchDeckEntry[],
        effectiveViewerProfile: Profile,
        restrictGalleryForViewer: boolean,
        viewerId: string,
    ): Promise<any[]> {
        const userIds = entries.map((entry) => entry.userId);
        if (userIds.length === 0) {
            return [];
        }

        const [profiles, pagePhotos, onlineUsers] = await Promise.all([
            this.profileRepository
                .createQueryBuilder('profile')
                .leftJoinAndSelect('profile.user', 'user')
                .select([
                    ...SearchService.DISCOVERY_PROFILE_SELECT,
                    ...SearchService.DISCOVERY_USER_SELECT,
                ])
                .where('profile.userId IN (:...userIds)', { userIds })
                .getMany(),
            this.photoRepository
                .createQueryBuilder('photo')
                .where('photo.userId IN (:...userIds)', { userIds })
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

        const profileMap = new Map(
            profiles.map((profile) => [profile.userId, profile]),
        );
        const photosMap = new Map<string, any[]>();
        for (const photo of pagePhotos) {
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

        return entries
            .map((entry) => {
                const rawProfile = profileMap.get(entry.userId);
                if (!rawProfile) {
                    return null;
                }

                const profile = this.resolveEffectiveProfileLocation(rawProfile);
                const maskedByGhost = this.shouldMaskGhostProfile(
                    profile.user as User | undefined,
                    viewerId,
                );

                const candidatePhotos = this.applyViewerPhotoAccessPolicy(
                    photosMap.get(profile.userId) ?? [],
                    profile.userId,
                    restrictGalleryForViewer,
                );
                const profilePhotos = maskedByGhost
                    ? this.applyGhostPhotoMask(candidatePhotos, profile.userId)
                    : candidatePhotos;

                return {
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
                        ) &&
                        this.extractPassportLocation(
                            profile.user as unknown as Record<string, unknown> | undefined,
                        ) != null,
                    isPremium: this.hasActivePremiumEntitlement(profile.user),
                    premiumStartDate: profile.user?.premiumStartDate ?? null,
                    premiumExpiryDate: profile.user?.premiumExpiryDate ?? null,
                    canViewAllPhotos: !restrictGalleryForViewer && !maskedByGhost,
                    lastLoginAt: profile.user?.lastLoginAt ?? null,
                    createdAt: profile.user?.createdAt ?? new Date(),
                    updatedAt: profile.user?.updatedAt ?? new Date(),
                    isOnline: onlineUserSet.has(profile.userId),
                    compatibilityScore: entry.compatibilityScore,
                    commonInterests: entry.commonInterests,
                    distanceKm:
                        entry.distanceKm ??
                        this.calculateDistanceKm(effectiveViewerProfile, profile),
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
                };
            })
            .filter((item): item is NonNullable<typeof item> => item != null);
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

    private applyFreeTierFilterLimits(
        filters: SearchFiltersDto,
        hasAdvancedFilterAccess: boolean,
    ): SearchFiltersDto {
        if (hasAdvancedFilterAccess) {
            return filters;
        }

        return {
            ...filters,
            education: undefined,
            religiousLevel: undefined,
            prayerFrequency: undefined,
            marriageIntention: undefined,
            timeFrame: undefined,
            intentMode: undefined,
            goGlobal: undefined,
            livingSituation: undefined,
            interests: undefined,
            languages: undefined,
            familyValues: undefined,
            nationalities: undefined,
            communicationStyles: undefined,
            verifiedOnly: undefined,
            onlineOnly: undefined,
            recentlyActiveOnly: undefined,
            withPhotosOnly: undefined,
            minTrustScore: undefined,
            backgroundCheckStatus: undefined,
        } as SearchFiltersDto;
    }

    private resolveEffectiveProfileLocation(profile: Profile): Profile {
        const passport = this.extractPassportLocation(
            profile.user as unknown as Record<string, unknown> | undefined,
        );
        if (!passport) {
            return profile;
        }
        const hasPassportCoordinates = this.hasValidCoordinates(
            passport.latitude,
            passport.longitude,
        );

        return {
            ...profile,
            city: passport.city ?? profile.city,
            country: passport.country ?? profile.country,
            latitude: hasPassportCoordinates ? passport.latitude : profile.latitude,
            longitude: hasPassportCoordinates ? passport.longitude : profile.longitude,
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

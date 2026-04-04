import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import {
    Profile,
    Gender,
    EducationLevel,
    ReligiousLevel,
} from '../../database/entities/profile.entity';
import { Photo, PhotoModerationStatus } from '../../database/entities/photo.entity';
import { BlockedUser } from '../../database/entities/blocked-user.entity';
import { Like } from '../../database/entities/like.entity';
import { Match, MatchStatus } from '../../database/entities/match.entity';
import { UserPreference } from '../../database/entities/user-preference.entity';
import { SearchFiltersDto } from './dto/search.dto';
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

    async search(userId: string, filters: SearchFiltersDto) {
        this.logger.log(
            `[Search] Starting search for userId=${userId}, filters=${JSON.stringify(filters)}`,
        );

        const page = filters.page ?? 1;
        const limit = filters.limit ?? 20;
        const cacheKey = `search:${userId}:${JSON.stringify(filters)}`;

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
                await this.redisService.del(cacheKey);
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
            this.userPreferenceRepository.findOne({ where: { userId } }),
        ]);

        if (!currentProfile) {
            this.logger.warn(`[Search] No profile found for userId=${userId}`);
            return { users: [], total: 0, page, limit };
        }

        const excludeIds = [userId, ...blockedIds].filter(Boolean);
        const activeCutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
        const hasUserLocation = !!(currentProfile.latitude && currentProfile.longitude);
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

        this.applyGenderFilter(query, filters, currentProfile, currentPreference);
        this.applyExplicitFilters(query, filters, currentProfile, hasUserLocation);
        this.applySavedPreferenceFilters(
            query,
            currentPreference,
            currentProfile,
            hasUserLocation,
        );

        if (hasUserLocation) {
            query.addSelect(
                `(6371 * acos(LEAST(1.0, cos(radians(:orderLat)) * cos(radians(profile.latitude)) * cos(radians(profile.longitude) - radians(:orderLng)) + sin(radians(:orderLat)) * sin(radians(profile.latitude)))))`,
                'distance',
            );
            query.setParameter('orderLat', currentProfile.latitude);
            query.setParameter('orderLng', currentProfile.longitude);
            query.orderBy('distance', 'ASC');
        } else {
            query.orderBy('profile.activityScore', 'DESC');
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
            photosMap.get(photo.userId)!.push({
                id: photo.id,
                url: photo.url,
                thumbnailUrl: CloudinaryService.thumbnailUrl(photo.url),
                mediumUrl: CloudinaryService.mediumUrl(photo.url),
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

        const rankedCandidates = candidateProfiles
            .filter((candidate) =>
                this.matchesPreference(currentPreference, candidate, currentProfile),
            )
            .filter((candidate) =>
                this.matchesPreference(
                    candidatePreferenceMap.get(candidate.userId),
                    currentProfile,
                    candidate,
                ),
            )
            .map((candidate) => {
                const candidatePhotos = photosMap.get(candidate.userId) ?? [];
                const compatibilityScore = this.computeCompatibility(
                    currentProfile,
                    candidate,
                    currentProfile.user?.selfieVerified ?? false,
                    candidate.user?.selfieVerified ?? false,
                );
                const commonInterests = this.getCommonInterests(
                    currentProfile.interests,
                    candidate.interests,
                );
                const distanceKm = this.calculateDistanceKm(currentProfile, candidate);
                const lastActiveAt = candidate.user?.lastLoginAt
                    ? new Date(candidate.user.lastLoginAt).getTime()
                    : 0;

                return {
                    profile: candidate,
                    photos: candidatePhotos,
                    compatibilityScore,
                    commonInterests,
                    distanceKm,
                    lastActiveAt,
                };
            })
            .sort((a, b) => {
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
                compatibilityScore,
                commonInterests,
                distanceKm,
            }) => ({
                id: profile.userId,
                username: profile.user?.username ?? null,
                email: profile.user?.email ?? '',
                firstName: profile.user?.firstName ?? null,
                lastName: profile.user?.lastName ?? null,
                phone: profile.user?.phone ?? null,
                role: profile.user?.role ?? 'user',
                status: profile.user?.status ?? 'active',
                emailVerified: profile.user?.emailVerified ?? false,
                selfieVerified: profile.user?.selfieVerified ?? false,
                isShadowBanned: profile.user?.isShadowBanned ?? false,
                trustScore: profile.user?.trustScore ?? 100,
                flagCount: profile.user?.flagCount ?? 0,
                deviceCount: profile.user?.deviceCount ?? 0,
                notificationsEnabled: profile.user?.notificationsEnabled ?? true,
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
                    bio: profile.bio,
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
        if (filters.city) {
            query.andWhere('LOWER(profile.city) LIKE LOWER(:city)', {
                city: `%${filters.city}%`,
            });
        }

        if (filters.country) {
            query.andWhere('LOWER(profile.country) LIKE LOWER(:country)', {
                country: `%${filters.country}%`,
            });
        }

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

        if (filters.marriageIntention) {
            query.andWhere('profile.marriageIntention = :marriageIntention', {
                marriageIntention: filters.marriageIntention,
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
                query.setParameter(parameterName, `%${interest}%`);
                return `profile.interests LIKE :${parameterName}`;
            });
            query.andWhere(`(${interestConditions.join(' OR ')})`);
        }

        if (filters.languages && filters.languages.length > 0) {
            const languageConditions = filters.languages.map((language, index) => {
                const parameterName = `language_${index}`;
                query.setParameter(parameterName, `%${language}%`);
                return `profile.languages LIKE :${parameterName}`;
            });
            query.andWhere(`(${languageConditions.join(' OR ')})`);
        }

        if (filters.familyValues && filters.familyValues.length > 0) {
            const familyValueConditions = filters.familyValues.map((familyValue, index) => {
                const parameterName = `familyValue_${index}`;
                query.setParameter(parameterName, `%${familyValue}%`);
                return `profile.familyValues LIKE :${parameterName}`;
            });
            query.andWhere(`(${familyValueConditions.join(' OR ')})`);
        }

        if (filters.nationalities && filters.nationalities.length > 0) {
            const nationalityConditions = filters.nationalities.map((nationality, index) => {
                const parameterName = `nationality_${index}`;
                query.setParameter(parameterName, `%${nationality}%`);
                return `(LOWER(profile.nationality) LIKE LOWER(:${parameterName}) OR profile.nationalities LIKE :${parameterName})`;
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
    ): void {
        if (!currentPreference) {
            return;
        }

        const now = new Date();
        if (currentPreference.maxAge) {
            const minDate = new Date(
                now.getFullYear() - currentPreference.maxAge,
                now.getMonth(),
                now.getDate(),
            );
            query.andWhere('profile.dateOfBirth >= :savedMinDate', {
                savedMinDate: minDate,
            });
        }
        if (currentPreference.minAge) {
            const maxDate = new Date(
                now.getFullYear() - currentPreference.minAge,
                now.getMonth(),
                now.getDate(),
            );
            query.andWhere('profile.dateOfBirth <= :savedMaxDate', {
                savedMaxDate: maxDate,
            });
        }
        if (currentPreference.preferredReligiousLevel) {
            query.andWhere('profile.religiousLevel = :savedReligiousLevel', {
                savedReligiousLevel: currentPreference.preferredReligiousLevel,
            });
        }
        if (currentPreference.preferredMaritalStatus) {
            query.andWhere('profile.maritalStatus = :savedMaritalStatus', {
                savedMaritalStatus: currentPreference.preferredMaritalStatus,
            });
        }
        if (currentPreference.preferredLanguages?.length) {
            const preferredLanguageConditions = currentPreference.preferredLanguages.map((language, index) => {
                const parameterName = `savedLanguage_${index}`;
                query.setParameter(parameterName, `%${language}%`);
                return `profile.languages LIKE :${parameterName}`;
            });
            query.andWhere(`(${preferredLanguageConditions.join(' OR ')})`);
        }
        if (currentPreference.preferredFamilyValues?.length) {
            const preferredFamilyConditions = currentPreference.preferredFamilyValues.map((familyValue, index) => {
                const parameterName = `savedFamilyValue_${index}`;
                query.setParameter(parameterName, `%${familyValue}%`);
                return `profile.familyValues LIKE :${parameterName}`;
            });
            query.andWhere(`(${preferredFamilyConditions.join(' OR ')})`);
        }
        if (currentPreference.maxDistance && hasUserLocation) {
            this.applyDistanceConstraint(
                query,
                currentProfile,
                currentPreference.maxDistance,
                'saved',
            );
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

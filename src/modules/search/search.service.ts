import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile } from '../../database/entities/profile.entity';
import { Photo } from '../../database/entities/photo.entity';
import { BlockedUser } from '../../database/entities/blocked-user.entity';
import { Like } from '../../database/entities/like.entity';
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
        private readonly redisService: RedisService,
    ) { }

    async search(userId: string, filters: SearchFiltersDto) {
        this.logger.log(`[Search] Starting search for userId=${userId}, filters=${JSON.stringify(filters)}`);

        // Check cache (skip if forceRefresh)
        const cacheKey = `search:${userId}:${JSON.stringify(filters)}`;
        if (!filters.forceRefresh) {
            try {
                const cached = await this.redisService.getJson<any>(cacheKey);
                if (cached) {
                    this.logger.log(`[Search] Cache hit for userId=${userId}`);
                    return cached;
                }
            } catch (err) {
                this.logger.warn(`[Search] Redis cache read failed, continuing without cache: ${err?.message}`);
            }
        } else {
            // Bust cache on force refresh
            try { await this.redisService.del(cacheKey); } catch (_) {}
        }

        // Get blocked users (cached 2 min)
        let blockedIds: string[] = [];
        try {
            blockedIds = await this.getCachedBlockedIds(userId);
        } catch (err) {
            this.logger.warn(`[Search] Failed to get blocked IDs, continuing: ${err?.message}`);
        }
        const excludeIds = [userId, ...blockedIds].filter(id => id); // Filter out any null/undefined
        
        // Validate userId exists
        if (!userId) {
            this.logger.error('[Search] No userId provided - returning empty results');
            return { users: [], total: 0, page: filters.page ?? 1, limit: filters.limit ?? 20 };
        }

        // Build query
        const query = this.profileRepository
            .createQueryBuilder('profile')
            .leftJoinAndSelect('profile.user', 'user')
            // Exclude myself and blocked users (ensure excludeIds is never empty)
            .where(excludeIds.length > 0 ? 'profile.userId NOT IN (:...excludeIds)' : '1=1', { excludeIds: excludeIds.length > 0 ? excludeIds : ['__none__'] })
            // Exclude users already swiped (liked / passed / complimented)
            .andWhere((qb) => {
                const subQuery = qb
                    .subQuery()
                    .select('1')
                    .from(Like, 'l')
                    .where('l.likerId = :userId')
                    .andWhere('l.likedId = profile.userId')
                    .getQuery();
                return `NOT EXISTS ${subQuery}`;
            }, { userId })
            .andWhere('user.status = :status', { status: 'active' });

        // Fetch logged-in user's profile once (used for gender logic + distance sorting)
        let myProfile: any = null;
        try {
            myProfile = await this.profileRepository.findOne({
                where: { userId },
                select: ['gender', 'latitude', 'longitude'],
            });
        } catch (err) {
            this.logger.warn(`[Search] Failed to fetch user profile for gender filter: ${err?.message}`);
        }
        this.logger.log(`[Search] myProfile for userId=${userId}: gender=${myProfile?.gender}, lat=${myProfile?.latitude}, lng=${myProfile?.longitude}`);

        // ── Gender logic: auto-show opposite gender ──
        // If explicit gender filter is passed, use it.
        // Otherwise, auto-detect from logged-in user's profile and show opposite.
        if (filters.gender) {
            query.andWhere('profile.gender = :gender', { gender: filters.gender });
        } else if (myProfile?.gender) {
            const oppositeGender = myProfile.gender === 'male' ? 'female' : 'male';
            query.andWhere('profile.gender = :gender', { gender: oppositeGender });
            this.logger.log(`[Search] Auto-filtering to opposite gender: ${oppositeGender}`);
        } else {
            this.logger.warn(`[Search] No gender filter applied — user has no profile or no gender set`);
        }

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

        // Age filter — include users with NULL dateOfBirth (incomplete profiles)
        if (filters.minAge || filters.maxAge) {
            const now = new Date();
            if (filters.maxAge) {
                const minDate = new Date(
                    now.getFullYear() - filters.maxAge,
                    now.getMonth(),
                    now.getDate(),
                );
                query.andWhere('(profile.dateOfBirth IS NULL OR profile.dateOfBirth >= :minDate)', { minDate });
            }
            if (filters.minAge) {
                const maxDate = new Date(
                    now.getFullYear() - filters.minAge,
                    now.getMonth(),
                    now.getDate(),
                );
                query.andWhere('(profile.dateOfBirth IS NULL OR profile.dateOfBirth <= :maxDate)', { maxDate });
            }
        }

        // Education filter
        if (filters.education) {
            query.andWhere('profile.education = :education', {
                education: filters.education,
            });
        }

        // Prayer frequency filter
        if (filters.prayerFrequency) {
            query.andWhere('profile.prayerFrequency = :prayerFrequency', {
                prayerFrequency: filters.prayerFrequency,
            });
        }

        // Marriage intention filter
        if (filters.marriageIntention) {
            query.andWhere('profile.marriageIntention = :marriageIntention', {
                marriageIntention: filters.marriageIntention,
            });
        }

        // Living situation filter
        if (filters.livingSituation) {
            query.andWhere('profile.livingSituation = :livingSituation', {
                livingSituation: filters.livingSituation,
            });
        }

        // Interests filter
        if (filters.interests && filters.interests.length > 0) {
            // Match profiles that have at least one of the specified interests
            const interestConditions = filters.interests.map((interest, i) => {
                const param = `interest_${i}`;
                query.setParameter(param, `%${interest}%`);
                return `profile.interests LIKE :${param}`;
            });
            query.andWhere(`(${interestConditions.join(' OR ')})`);
        }

        // Verified only filter
        if (filters.verifiedOnly) {
            query.andWhere('user.selfieVerified = :verified', { verified: true });
        }

        // Reuse myProfile (fetched earlier) for distance sorting
        const hasUserLocation = !!(myProfile?.latitude && myProfile?.longitude);

        // Distance filter (requires user's location)
        // Include profiles with NULL lat/lng so users without location aren't excluded
        if (filters.maxDistance && hasUserLocation) {
            const latDelta = filters.maxDistance / 111;
            const lngDelta = filters.maxDistance / (111 * Math.cos(Number(myProfile.latitude) * Math.PI / 180));
            query.andWhere(
                `(profile.latitude IS NULL OR (profile.latitude BETWEEN :sMinLat AND :sMaxLat AND profile.longitude BETWEEN :sMinLng AND :sMaxLng AND (6371 * acos(cos(radians(:userLat)) * cos(radians(profile.latitude)) * cos(radians(profile.longitude) - radians(:userLng)) + sin(radians(:userLat)) * sin(radians(profile.latitude)))) <= :maxDist))`,
                {
                    sMinLat: Number(myProfile.latitude) - latDelta,
                    sMaxLat: Number(myProfile.latitude) + latDelta,
                    sMinLng: Number(myProfile.longitude) - lngDelta,
                    sMaxLng: Number(myProfile.longitude) + lngDelta,
                    userLat: myProfile.latitude,
                    userLng: myProfile.longitude,
                    maxDist: filters.maxDistance,
                },
            );
        }

        // Full-text search on bio
        if (filters.q) {
            query.andWhere('LOWER(profile.bio) LIKE LOWER(:q)', {
                q: `%${filters.q}%`,
            });
        }

        // Name search (firstName or lastName)
        if (filters.name) {
            query.andWhere(
                '(LOWER(user.firstName) LIKE LOWER(:nameSearch) OR LOWER(user.lastName) LIKE LOWER(:nameSearch))',
                { nameSearch: `%${filters.name}%` },
            );
        }

        // Sort by distance (nearest first) when user has location, else by activityScore
        if (hasUserLocation) {
            query.addSelect(
                `(6371 * acos(LEAST(1.0, cos(radians(:orderLat)) * cos(radians(profile.latitude)) * cos(radians(profile.longitude) - radians(:orderLng)) + sin(radians(:orderLat)) * sin(radians(profile.latitude)))))`,
                'distance',
            );
            query.setParameter('orderLat', myProfile.latitude);
            query.setParameter('orderLng', myProfile.longitude);
            query.orderBy('distance', 'ASC');
        } else {
            query.orderBy('profile.activityScore', 'DESC');
        }
        query.skip(((filters.page ?? 1) - 1) * (filters.limit ?? 20));
        query.take(filters.limit ?? 20);

        const [profiles, total] = await query.getManyAndCount();

        // Batch fetch ALL photos for all profiles (avoids N+1 query)
        const userIds = profiles.map(p => p.userId);
        const photos = userIds.length > 0
            ? await this.photoRepository
                .createQueryBuilder('photo')
                .where('photo.userId IN (:...userIds)', { userIds })
                .andWhere('photo.moderationStatus = :approvedStatus', { approvedStatus: 'approved' })
                .orderBy('photo.isMain', 'DESC')
                .addOrderBy('photo.order', 'ASC')
                .getMany()
            : [];
        // Group photos by userId
        const photosMap = new Map<string, any[]>();
        for (const photo of photos) {
            if (!photosMap.has(photo.userId)) photosMap.set(photo.userId, []);
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

        // Return enriched user objects matching Flutter UserModel.fromJson format
        const users = profiles.map((p) => ({
            id: p.userId,
            username: p.user?.username ?? null,
            email: p.user?.email ?? '',
            firstName: p.user?.firstName ?? null,
            lastName: p.user?.lastName ?? null,
            phone: p.user?.phone ?? null,
            role: p.user?.role ?? 'user',
            status: p.user?.status ?? 'active',
            emailVerified: p.user?.emailVerified ?? false,
            selfieVerified: p.user?.selfieVerified ?? false,
            isShadowBanned: p.user?.isShadowBanned ?? false,
            trustScore: p.user?.trustScore ?? 100,
            flagCount: p.user?.flagCount ?? 0,
            deviceCount: p.user?.deviceCount ?? 0,
            notificationsEnabled: p.user?.notificationsEnabled ?? true,
            lastLoginAt: p.user?.lastLoginAt ?? null,
            createdAt: p.user?.createdAt ?? new Date(),
            updatedAt: p.user?.updatedAt ?? new Date(),
            photos: photosMap.get(p.userId) ?? [],
            profile: {
                id: p.id,
                gender: p.gender,
                dateOfBirth: p.dateOfBirth,
                bio: p.bio,
                ethnicity: p.ethnicity,
                nationality: p.nationality,
                city: p.city,
                country: p.country,
                latitude: p.latitude,
                longitude: p.longitude,
                religiousLevel: p.religiousLevel,
                sect: p.sect,
                prayerFrequency: p.prayerFrequency,
                marriageIntention: p.marriageIntention,
                maritalStatus: p.maritalStatus,
                education: p.education,
                jobTitle: p.jobTitle,
                company: p.company,
                height: p.height,
                weight: p.weight,
                interests: p.interests,
                languages: p.languages,
                intentMode: p.intentMode ?? null,
                secondWifePreference: p.secondWifePreference ?? null,
                profileCompletionPercentage: p.profileCompletionPercentage ?? 0,
                activityScore: p.activityScore ?? 0,
                isComplete: p.isComplete ?? false,
            },
        }));

        const response = {
            users,
            total,
            page: filters.page ?? 1,
            limit: filters.limit ?? 20,
        };

        // Cache for 3 minutes (shorter = fresher results for active users)
        try {
            await this.redisService.setJson(cacheKey, response, 180);
        } catch (err) {
            this.logger.warn(`[Search] Redis cache write failed, continuing: ${err?.message}`);
        }

        this.logger.log(`[Search] Returning ${users.length} users for userId=${userId}`);
        return response;
    }

    /** Cache blocked user IDs per user — avoids DB hit on every search */
    private async getCachedBlockedIds(userId: string): Promise<string[]> {
        const cacheKey = `blocked_ids:${userId}`;
        const cached = await this.redisService.getJson<string[]>(cacheKey);
        if (cached) return cached;

        const blockedUsers = await this.blockedUserRepository.find({
            where: [{ blockerId: userId }, { blockedId: userId }],
            select: ['blockerId', 'blockedId'],
        });
        const ids = blockedUsers.map((b) =>
            b.blockerId === userId ? b.blockedId : b.blockerId,
        );
        await this.redisService.setJson(cacheKey, ids, 120); // 2 min TTL
        return ids;
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

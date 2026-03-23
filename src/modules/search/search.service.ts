import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile } from '../../database/entities/profile.entity';
import { Photo } from '../../database/entities/photo.entity';
import { BlockedUser } from '../../database/entities/blocked-user.entity';
import { SearchFiltersDto } from './dto/search.dto';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class SearchService {
    constructor(
        @InjectRepository(Profile)
        private readonly profileRepository: Repository<Profile>,
        @InjectRepository(Photo)
        private readonly photoRepository: Repository<Photo>,
        @InjectRepository(BlockedUser)
        private readonly blockedUserRepository: Repository<BlockedUser>,
        private readonly redisService: RedisService,
    ) { }

    async search(userId: string, filters: SearchFiltersDto) {
        // Check cache
        const cacheKey = `search:${userId}:${JSON.stringify(filters)}`;
        const cached = await this.redisService.getJson<any>(cacheKey);
        if (cached) return cached;

        // Get blocked users
        const blockedUsers = await this.blockedUserRepository.find({
            where: [{ blockerId: userId }, { blockedId: userId }],
        });
        const blockedIds = blockedUsers.map((b) =>
            b.blockerId === userId ? b.blockedId : b.blockerId,
        );
        const excludeIds = [userId, ...blockedIds];

        // Build query
        const query = this.profileRepository
            .createQueryBuilder('profile')
            .leftJoinAndSelect('profile.user', 'user')
            .where('profile.userId NOT IN (:...excludeIds)', { excludeIds })
            .andWhere('user.status = :status', { status: 'active' })
            .andWhere('profile.isComplete = :complete', { complete: true });

        // Apply filters
        if (filters.gender) {
            query.andWhere('profile.gender = :gender', { gender: filters.gender });
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

        // Age filter
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

        // Education filter
        if (filters.education) {
            query.andWhere('profile.education = :education', {
                education: filters.education,
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

        // Always fetch user's location for distance sorting
        const userProfile = await this.profileRepository.findOne({
            where: { userId },
            select: ['latitude', 'longitude'],
        });
        const hasUserLocation = !!(userProfile?.latitude && userProfile?.longitude);

        // Distance filter (requires user's location)
        if (filters.maxDistance && hasUserLocation) {
            // Bounding box pre-filter (uses indexes, avoids full-table Haversine)
            const latDelta = filters.maxDistance / 111;
            const lngDelta = filters.maxDistance / (111 * Math.cos(Number(userProfile.latitude) * Math.PI / 180));
            query.andWhere('profile.latitude BETWEEN :sMinLat AND :sMaxLat', {
                sMinLat: Number(userProfile.latitude) - latDelta,
                sMaxLat: Number(userProfile.latitude) + latDelta,
            });
            query.andWhere('profile.longitude BETWEEN :sMinLng AND :sMaxLng', {
                sMinLng: Number(userProfile.longitude) - lngDelta,
                sMaxLng: Number(userProfile.longitude) + lngDelta,
            });
            // Precise Haversine filter
            query.andWhere(
                `(6371 * acos(cos(radians(:userLat)) * cos(radians(profile.latitude)) * cos(radians(profile.longitude) - radians(:userLng)) + sin(radians(:userLat)) * sin(radians(profile.latitude)))) <= :maxDist`,
                { userLat: userProfile.latitude, userLng: userProfile.longitude, maxDist: filters.maxDistance },
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
            query.setParameter('orderLat', userProfile.latitude);
            query.setParameter('orderLng', userProfile.longitude);
            query.orderBy('distance', 'ASC');
        } else {
            query.orderBy('profile.activityScore', 'DESC');
        }
        query.skip(((filters.page ?? 1) - 1) * (filters.limit ?? 20));
        query.take(filters.limit ?? 20);

        const [profiles, total] = await query.getManyAndCount();

        // Batch fetch main photos for all profiles (avoids N+1 query)
        const userIds = profiles.map(p => p.userId);
        const photos = userIds.length > 0
            ? await this.photoRepository
                .createQueryBuilder('photo')
                .where('photo.userId IN (:...userIds)', { userIds })
                .andWhere('photo.isMain = :isMain', { isMain: true })
                .getMany()
            : [];
        const photoMap = new Map(photos.map(p => [p.userId, p.url]));

        const results = profiles.map((p) => ({
            userId: p.userId,
            firstName: p.user?.firstName,
            lastName: p.user?.lastName,
            age: this.calculateAge(p.dateOfBirth),
            bio: p.bio,
            city: p.city,
            country: p.country,
            gender: p.gender,
            religiousLevel: p.religiousLevel,
            maritalStatus: p.maritalStatus,
            interests: p.interests,
            photo: photoMap.get(p.userId) || null,
        }));

        const response = {
            results,
            total,
            page: filters.page,
            limit: filters.limit,
        };

        // Cache for 5 minutes
        await this.redisService.setJson(cacheKey, response, 300);

        return response;
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

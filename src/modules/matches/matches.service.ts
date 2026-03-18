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
import { User } from '../../database/entities/user.entity';
import { RedisService } from '../redis/redis.service';
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

        const enriched = await Promise.all(
            matches.map(async (match) => {
                const otherUserId = match.user1Id === userId ? match.user2Id : match.user1Id;
                const otherUser = match.user1Id === userId ? match.user2 : match.user1;
                const photo = await this.photoRepository.findOne({
                    where: { userId: otherUserId, isMain: true },
                });
                const isOnline = await this.redisService.isUserOnline(otherUserId);
                return {
                    id: match.id,
                    matchedAt: match.matchedAt,
                    user: {
                        id: otherUser.id,
                        firstName: otherUser.firstName,
                        lastName: otherUser.lastName,
                        photo: photo?.url || null,
                        isOnline,
                    },
                };
            }),
        );

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
    }

    // ─── NEARBY USERS RADAR ─────────────────────────────────

    async getNearbyUsers(userId: string, radiusKm: number = 50, limit: number = 30) {
        const profile = await this.profileRepository.findOne({ where: { userId } });
        if (!profile || !profile.latitude || !profile.longitude) {
            return [];
        }

        const excludeIds = await this.getExcludeIds(userId);

        // Haversine formula in SQL for distance calculation
        const query = this.profileRepository
            .createQueryBuilder('profile')
            .leftJoinAndSelect('profile.user', 'user')
            .addSelect(
                `(6371 * acos(cos(radians(:lat)) * cos(radians(profile.latitude)) * cos(radians(profile.longitude) - radians(:lng)) + sin(radians(:lat)) * sin(radians(profile.latitude))))`,
                'distance',
            )
            .where('profile.userId NOT IN (:...excludeIds)', { excludeIds })
            .andWhere('user.status = :status', { status: 'active' })
            .andWhere('user.locationEnabled = :locEnabled', { locEnabled: true })
            .andWhere('profile.latitude IS NOT NULL')
            .andWhere('profile.longitude IS NOT NULL')
            .having('distance <= :radius', { radius: radiusKm })
            .setParameters({ lat: profile.latitude, lng: profile.longitude })
            .orderBy('distance', 'ASC')
            .take(limit);

        const results = await query.getRawAndEntities();

        const enriched = await Promise.all(
            results.entities.map(async (p, index) => {
                const photo = await this.photoRepository.findOne({
                    where: { userId: p.userId, isMain: true },
                });
                const rawDistance = results.raw[index]?.distance;
                return {
                    userId: p.userId,
                    firstName: p.user?.firstName,
                    lastName: p.user?.lastName,
                    age: this.calculateAge(p.dateOfBirth),
                    bio: p.bio,
                    city: p.city,
                    gender: p.gender,
                    religiousLevel: p.religiousLevel,
                    distanceKm: rawDistance ? Math.round(parseFloat(rawDistance) * 10) / 10 : null,
                    photo: photo?.url || null,
                };
            }),
        );

        return enriched;
    }

    // ─── DISCOVERY CATEGORIES ───────────────────────────────

    async getDiscoveryCategories(userId: string) {
        const [nearby, compatible, newUsers] = await Promise.all([
            this.getNearbyUsers(userId, 30, 10),
            this.getSuggestions(userId, 10),
            this.getNewUsers(userId, 10),
        ]);

        return {
            nearby: { title: 'Nearby', users: nearby },
            compatible: { title: 'Most Compatible', users: compatible },
            newUsers: { title: 'New Members', users: newUsers },
        };
    }

    private async getNewUsers(userId: string, limit: number) {
        const excludeIds = await this.getExcludeIds(userId);
        const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const profiles = await this.profileRepository
            .createQueryBuilder('profile')
            .leftJoinAndSelect('profile.user', 'user')
            .where('profile.userId NOT IN (:...excludeIds)', { excludeIds })
            .andWhere('user.status = :status', { status: 'active' })
            .andWhere('user.createdAt >= :since', { since: oneWeekAgo })
            .orderBy('user.createdAt', 'DESC')
            .take(limit)
            .getMany();

        return Promise.all(
            profiles.map(async (p) => {
                const photo = await this.photoRepository.findOne({
                    where: { userId: p.userId, isMain: true },
                });
                return {
                    userId: p.userId,
                    firstName: p.user?.firstName,
                    lastName: p.user?.lastName,
                    age: this.calculateAge(p.dateOfBirth),
                    bio: p.bio,
                    city: p.city,
                    photo: photo?.url || null,
                };
            }),
        );
    }

    // ─── SUGGESTIONS ────────────────────────────────────────

    async getSuggestions(userId: string, limit: number = 20) {
        const cacheKey = `suggestions:${userId}`;
        const cached = await this.redisService.getJson<any[]>(cacheKey);
        if (cached && cached.length > 0) return cached;

        const profile = await this.profileRepository.findOne({ where: { userId } });
        const preferences = await this.preferenceRepository.findOne({ where: { userId } });

        if (!profile) return [];

        const excludeIds = await this.getExcludeIds(userId);

        const query = this.profileRepository
            .createQueryBuilder('profile')
            .leftJoinAndSelect('profile.user', 'user')
            .where('profile.userId NOT IN (:...excludeIds)', { excludeIds })
            .andWhere('user.status = :status', { status: 'active' })
            .andWhere('profile.isComplete = :complete', { complete: true });

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
            // Distance filter
            if (preferences.maxDistance && profile.latitude && profile.longitude) {
                query.andWhere(
                    `(6371 * acos(cos(radians(:lat)) * cos(radians(profile.latitude)) * cos(radians(profile.longitude) - radians(:lng)) + sin(radians(:lat)) * sin(radians(profile.latitude)))) <= :maxDist`,
                    { lat: profile.latitude, lng: profile.longitude, maxDist: preferences.maxDistance },
                );
            }
        }

        query.orderBy('profile.activityScore', 'DESC');
        query.addOrderBy('profile.createdAt', 'DESC');
        query.take(limit);

        const suggestions = await query.getMany();

        const enriched = await Promise.all(
            suggestions.map(async (p) => {
                const photo = await this.photoRepository.findOne({
                    where: { userId: p.userId, isMain: true },
                });
                const distanceKm = (profile.latitude && profile.longitude && p.latitude && p.longitude)
                    ? this.haversineDistance(profile.latitude, profile.longitude, p.latitude, p.longitude)
                    : null;
                return {
                    userId: p.userId,
                    firstName: p.user?.firstName,
                    lastName: p.user?.lastName,
                    age: this.calculateAge(p.dateOfBirth),
                    bio: p.bio,
                    city: p.city,
                    country: p.country,
                    gender: p.gender,
                    religiousLevel: p.religiousLevel,
                    marriageIntention: p.marriageIntention,
                    interests: p.interests,
                    distanceKm: distanceKm !== null ? Math.round(distanceKm * 10) / 10 : null,
                    photo: photo?.url || null,
                };
            }),
        );

        await this.redisService.setJson(cacheKey, enriched, 600);
        return enriched;
    }

    // ─── PRIVATE HELPERS ────────────────────────────────────

    private async getExcludeIds(userId: string): Promise<string[]> {
        const blockedUsers = await this.blockedUserRepository.find({
            where: [{ blockerId: userId }, { blockedId: userId }],
        });
        const blockedIds = blockedUsers.map((b) => b.blockerId === userId ? b.blockedId : b.blockerId);

        const swipedLikes = await this.likeRepository.find({
            where: { likerId: userId },
            select: ['likedId'],
        });
        const swipedIds = swipedLikes.map((l) => l.likedId);

        const matches = await this.matchRepository.find({
            where: [
                { user1Id: userId, status: MatchStatus.ACTIVE },
                { user2Id: userId, status: MatchStatus.ACTIVE },
            ],
        });
        const matchedIds = matches.map((m) => m.user1Id === userId ? m.user2Id : m.user1Id);

        return [...new Set([userId, ...blockedIds, ...swipedIds, ...matchedIds])];
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

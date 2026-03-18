import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { Profile } from '../../database/entities/profile.entity';
import { Like, LikeType } from '../../database/entities/like.entity';
import { Match, MatchStatus } from '../../database/entities/match.entity';
import { UserBehavior } from '../../database/entities/user-behavior.entity';
import { UserPreference } from '../../database/entities/user-preference.entity';
import { Photo } from '../../database/entities/photo.entity';
import { BlockedUser } from '../../database/entities/blocked-user.entity';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class MatchingService {
    private readonly logger = new Logger(MatchingService.name);

    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(Profile)
        private readonly profileRepository: Repository<Profile>,
        @InjectRepository(Like)
        private readonly likeRepository: Repository<Like>,
        @InjectRepository(Match)
        private readonly matchRepository: Repository<Match>,
        @InjectRepository(UserBehavior)
        private readonly behaviorRepository: Repository<UserBehavior>,
        @InjectRepository(UserPreference)
        private readonly preferenceRepository: Repository<UserPreference>,
        @InjectRepository(Photo)
        private readonly photoRepository: Repository<Photo>,
        @InjectRepository(BlockedUser)
        private readonly blockedUserRepository: Repository<BlockedUser>,
        private readonly redisService: RedisService,
    ) { }

    // ─── BEHAVIOR TRACKING ──────────────────────────────────

    async trackSwipeBehavior(userId: string, targetUserId: string, action: LikeType): Promise<void> {
        const targetProfile = await this.profileRepository.findOne({ where: { userId: targetUserId } });
        if (!targetProfile) return;

        let behavior = await this.behaviorRepository.findOne({ where: { userId } });
        if (!behavior) {
            behavior = this.behaviorRepository.create({ userId });
        }

        // Update counters
        if (action === LikeType.LIKE || action === LikeType.SUPER_LIKE || action === LikeType.COMPLIMENT) {
            behavior.totalLikes++;
            if (action === LikeType.SUPER_LIKE) behavior.totalSuperLikes++;

            // Learn from likes — aggregate preferred attributes
            this.updatePreferredAttributes(behavior, targetProfile, true);
        } else {
            behavior.totalPasses++;
            this.updatePreferredAttributes(behavior, targetProfile, false);
        }

        behavior.lastActiveDate = new Date();

        // Recalculate like-to-match ratio
        if (behavior.totalLikes > 0) {
            behavior.likeToMatchRatio = behavior.totalMatches / behavior.totalLikes;
        }

        await this.behaviorRepository.save(behavior);

        // Invalidate cached suggestions
        await this.redisService.del(`suggestions:${userId}`);
        await this.redisService.del(`smart_suggestions:${userId}`);
    }

    private updatePreferredAttributes(behavior: UserBehavior, profile: Profile, isLike: boolean): void {
        if (!isLike) return; // Only learn from positive signals

        // Track preferred ethnicities
        if (profile.ethnicity) {
            const ethnicities = behavior.preferredEthnicities || [];
            if (!ethnicities.includes(profile.ethnicity)) {
                ethnicities.push(profile.ethnicity);
            }
            behavior.preferredEthnicities = ethnicities;
        }

        // Track preferred religious levels
        if (profile.religiousLevel) {
            const levels = behavior.preferredReligiousLevels || [];
            if (!levels.includes(profile.religiousLevel)) {
                levels.push(profile.religiousLevel);
            }
            behavior.preferredReligiousLevels = levels;
        }

        // Track preferred interests
        if (profile.interests?.length) {
            const interests = behavior.preferredInterests || [];
            for (const interest of profile.interests) {
                if (!interests.includes(interest)) {
                    interests.push(interest);
                }
            }
            behavior.preferredInterests = interests.slice(0, 30); // cap at 30
        }

        // Adjust age range based on liked profiles
        if (profile.dateOfBirth) {
            const age = this.calculateAge(profile.dateOfBirth);
            if (!behavior.preferredAgeMin || age < behavior.preferredAgeMin) {
                behavior.preferredAgeMin = age;
            }
            if (!behavior.preferredAgeMax || age > behavior.preferredAgeMax) {
                behavior.preferredAgeMax = age;
            }
        }
    }

    // ─── SMART SUGGESTIONS WITH BEHAVIOR LEARNING ───────────

    async getSmartSuggestions(userId: string, limit: number = 20): Promise<any[]> {
        const cacheKey = `smart_suggestions:${userId}`;
        const cached = await this.redisService.getJson<any[]>(cacheKey);
        if (cached && cached.length > 0) return cached;

        const profile = await this.profileRepository.findOne({ where: { userId } });
        const preferences = await this.preferenceRepository.findOne({ where: { userId } });
        const behavior = await this.behaviorRepository.findOne({ where: { userId } });

        if (!profile) return [];

        const excludeIds = await this.getExcludeIds(userId);

        const query = this.profileRepository
            .createQueryBuilder('profile')
            .leftJoinAndSelect('profile.user', 'user')
            .where('profile.userId NOT IN (:...excludeIds)', { excludeIds })
            .andWhere('user.status = :status', { status: 'active' })
            .andWhere('user.isShadowBanned = :sb', { sb: false });

        // Apply explicit preferences first
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
        }

        // Apply behavior-learned preferences (soft filters via scoring)
        // We fetch more candidates and rank them
        query.take(limit * 3);

        const candidates = await query.getMany();

        // Score and rank candidates
        const scored = candidates.map(candidate => {
            let score = 0;

            // 1. Activity recency (recently active users ranked higher)
            const daysSinceActive = candidate.user?.lastLoginAt
                ? (Date.now() - new Date(candidate.user.lastLoginAt).getTime()) / (1000 * 60 * 60 * 24)
                : 999;
            if (daysSinceActive < 1) score += 30;
            else if (daysSinceActive < 3) score += 20;
            else if (daysSinceActive < 7) score += 10;

            // 2. Boosted profiles
            if (candidate.user?.boostedUntil && new Date(candidate.user.boostedUntil) > new Date()) {
                score += 25;
            }

            // 3. Profile completeness
            score += (candidate.profileCompletionPercentage || 0) * 0.15;

            // 4. Selfie verified bonus
            if (candidate.user?.selfieVerified) score += 10;

            // 5. Behavior-based matching (if behavior data exists)
            if (behavior) {
                // Ethnicity match
                if (behavior.preferredEthnicities?.includes(candidate.ethnicity)) {
                    score += 15;
                }
                // Religious level match
                if (behavior.preferredReligiousLevels?.includes(candidate.religiousLevel)) {
                    score += 15;
                }
                // Interest overlap
                if (behavior.preferredInterests && candidate.interests) {
                    const overlap = candidate.interests.filter(i => behavior.preferredInterests.includes(i));
                    score += overlap.length * 5;
                }
            }

            // 6. Trust score factor
            const trustScore = candidate.user?.trustScore ?? 100;
            score += trustScore * 0.1;

            return { profile: candidate, score };
        });

        // Sort by score descending and take top N
        scored.sort((a, b) => b.score - a.score);
        const topCandidates = scored.slice(0, limit);

        const enriched = await Promise.all(
            topCandidates.map(async ({ profile: p, score }) => {
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
                    country: p.country,
                    gender: p.gender,
                    religiousLevel: p.religiousLevel,
                    marriageIntention: p.marriageIntention,
                    interests: p.interests,
                    selfieVerified: p.user?.selfieVerified ?? false,
                    photo: photo?.url || null,
                    matchScore: Math.round(score),
                };
            }),
        );

        await this.redisService.setJson(cacheKey, enriched, 300); // 5 min cache
        return enriched;
    }

    // ─── PRECOMPUTE & CACHE COMPATIBILITY SCORES ────────────

    async precomputeCompatibility(userId: string): Promise<void> {
        const profile = await this.profileRepository.findOne({ where: { userId } });
        if (!profile) return;

        const excludeIds = await this.getExcludeIds(userId);

        const candidates = await this.profileRepository
            .createQueryBuilder('profile')
            .where('profile.userId NOT IN (:...excludeIds)', { excludeIds })
            .take(100)
            .getMany();

        const scores: Record<string, number> = {};

        for (const candidate of candidates) {
            scores[candidate.userId] = this.computeCompatibility(profile, candidate);
        }

        // Cache for 1 hour
        await this.redisService.setJson(`compat:${userId}`, scores, 3600);
        this.logger.debug(`Precomputed compatibility for ${userId}: ${Object.keys(scores).length} candidates`);
    }

    async getCachedCompatibility(userId: string, targetUserId: string): Promise<number | null> {
        const scores = await this.redisService.getJson<Record<string, number>>(`compat:${userId}`);
        return scores?.[targetUserId] ?? null;
    }

    private computeCompatibility(a: Profile, b: Profile): number {
        let score = 0;
        const maxScore = 100;

        // Religious level (30 points)
        if (a.religiousLevel === b.religiousLevel) score += 30;
        else score += 10;

        // Marriage intention (25 points)
        if (a.marriageIntention && b.marriageIntention && a.marriageIntention === b.marriageIntention) score += 25;
        else if (a.marriageIntention && b.marriageIntention) score += 8;

        // Interest overlap (20 points)
        if (a.interests?.length && b.interests?.length) {
            const overlap = a.interests.filter(i => b.interests.includes(i));
            const overlapRatio = overlap.length / Math.max(a.interests.length, b.interests.length);
            score += Math.round(overlapRatio * 20);
        }

        // Family plans (15 points)
        if (a.familyPlans && b.familyPlans && a.familyPlans === b.familyPlans) score += 15;
        else if (a.familyPlans && b.familyPlans) score += 5;

        // Location proximity (10 points)
        if (a.city && b.city && a.city.toLowerCase() === b.city.toLowerCase()) score += 10;
        else if (a.country && b.country && a.country.toLowerCase() === b.country.toLowerCase()) score += 5;

        return Math.min(score, maxScore);
    }

    // ─── HELPERS ────────────────────────────────────────────

    private async getExcludeIds(userId: string): Promise<string[]> {
        const blockedUsers = await this.blockedUserRepository.find({
            where: [{ blockerId: userId }, { blockedId: userId }],
        });
        const blockedIds = blockedUsers.map(b => b.blockerId === userId ? b.blockedId : b.blockerId);

        const swipedLikes = await this.likeRepository.find({
            where: { likerId: userId },
            select: ['likedId'],
        });
        const swipedIds = swipedLikes.map(l => l.likedId);

        const matches = await this.matchRepository.find({
            where: [
                { user1Id: userId, status: MatchStatus.ACTIVE },
                { user2Id: userId, status: MatchStatus.ACTIVE },
            ],
        });
        const matchedIds = matches.map(m => m.user1Id === userId ? m.user2Id : m.user1Id);

        return [...new Set([userId, ...blockedIds, ...swipedIds, ...matchedIds])];
    }

    private calculateAge(dateOfBirth: Date): number {
        const today = new Date();
        const birth = new Date(dateOfBirth);
        let age = today.getFullYear() - birth.getFullYear();
        const m = today.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
        return age;
    }
}

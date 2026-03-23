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

        // Pre-fetch behavior data for response rate scoring
        const candidateUserIds = candidates.map(c => c.userId);
        const candidateBehaviors = candidateUserIds.length > 0
            ? await this.behaviorRepository
                .createQueryBuilder('b')
                .where('b.userId IN (:...ids)', { ids: candidateUserIds })
                .getMany()
            : [];
        const candidateBehaviorMap = new Map(candidateBehaviors.map(b => [b.userId, b]));

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

            // 7. Response rate factor (5% weight from spec priority ranking)
            // Users who respond to messages get ranked higher
            const candidateBehavior = candidateBehaviorMap.get(candidate.userId);
            if (candidateBehavior?.responseRate) {
                score += candidateBehavior.responseRate * 10; // 0-10 points
            }

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

    /**
     * PDF-spec compatibility scoring (0-100):
     *   Shared Interests: 25 points
     *   Location Proximity: 20 points
     *   Religious Practice: 20 points
     *   Cultural Background: 15 points
     *   Family Values: 10 points
     *   Education Level: 5 points
     *   Lifestyle: 5 points
     *   Bonuses: verified +5%, complete profile +3%
     */
    private computeCompatibility(a: Profile, b: Profile, aUser?: User, bUser?: User): number {
        let score = 0;

        // 1. Shared Interests (25 points)
        if (a.interests?.length && b.interests?.length) {
            const overlap = a.interests.filter(i => b.interests.includes(i));
            const overlapRatio = overlap.length / Math.max(a.interests.length, b.interests.length);
            score += Math.round(overlapRatio * 25);
        }

        // 2. Location Proximity (20 points)
        if (a.latitude && a.longitude && b.latitude && b.longitude) {
            const dist = this.haversineDistance(
                Number(a.latitude), Number(a.longitude),
                Number(b.latitude), Number(b.longitude),
            );
            if (dist <= 10) score += 20;
            else if (dist <= 50) score += 15;
            else if (dist <= 100) score += 10;
            else score += 5;
        } else if (a.city && b.city && a.city.toLowerCase() === b.city.toLowerCase()) {
            score += 20;
        } else if (a.country && b.country && a.country.toLowerCase() === b.country.toLowerCase()) {
            score += 10;
        }

        // 3. Religious Practice (20 points)
        if (a.religiousLevel === b.religiousLevel) score += 20;
        else {
            const levels = ['liberal', 'moderate', 'practicing', 'very_practicing'];
            const aIdx = levels.indexOf(a.religiousLevel);
            const bIdx = levels.indexOf(b.religiousLevel);
            if (aIdx >= 0 && bIdx >= 0 && Math.abs(aIdx - bIdx) === 1) score += 12;
            else score += 6;
        }

        // 4. Cultural Background (15 points)
        if (a.ethnicity && b.ethnicity && a.ethnicity.toLowerCase() === b.ethnicity.toLowerCase()) {
            score += 15;
        } else if (a.nationality && b.nationality && a.nationality.toLowerCase() === b.nationality.toLowerCase()) {
            score += 10;
        } else {
            score += 5;
        }

        // 5. Family Values (10 points)
        if (a.familyValues?.length && b.familyValues?.length) {
            const overlap = a.familyValues.filter(v => b.familyValues.includes(v));
            const ratio = overlap.length / Math.max(a.familyValues.length, b.familyValues.length);
            score += Math.round(ratio * 10);
        } else if (a.familyPlans && b.familyPlans && a.familyPlans === b.familyPlans) {
            score += 10;
        } else if (a.familyPlans && b.familyPlans) {
            score += 5;
        }

        // 6. Education Level (5 points)
        if (a.education && b.education) {
            if (a.education === b.education) score += 5;
            else {
                const eduLevels = ['high_school', 'bachelors', 'masters', 'doctorate'];
                const aIdx = eduLevels.indexOf(a.education);
                const bIdx = eduLevels.indexOf(b.education);
                if (aIdx >= 0 && bIdx >= 0 && Math.abs(aIdx - bIdx) <= 1) score += 3;
                else score += 2;
            }
        }

        // 7. Lifestyle (5 points)
        let lifestyleMatch = 0;
        let lifestyleTotal = 0;
        if (a.dietary && b.dietary) { lifestyleTotal++; if (a.dietary === b.dietary) lifestyleMatch++; }
        if (a.alcohol && b.alcohol) { lifestyleTotal++; if (a.alcohol === b.alcohol) lifestyleMatch++; }
        if (a.sleepSchedule && b.sleepSchedule) { lifestyleTotal++; if (a.sleepSchedule === b.sleepSchedule) lifestyleMatch++; }
        if (lifestyleTotal > 0) {
            score += Math.round((lifestyleMatch / lifestyleTotal) * 5);
        } else {
            score += 2;
        }

        // Bonuses
        if (aUser?.selfieVerified && bUser?.selfieVerified) {
            score = Math.round(score * 1.05); // +5% both verified
        }
        if (a.isComplete && b.isComplete) {
            score = Math.round(score * 1.03); // +3% both complete
        }

        return Math.min(score, 100);
    }

    /**
     * Haversine formula: distance in km between two lat/lng points
     */
    private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371; // Earth's radius in km
        const dLat = this.deg2rad(lat2 - lat1);
        const dLon = this.deg2rad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    private deg2rad(deg: number): number {
        return deg * (Math.PI / 180);
    }

    // ─── COLLABORATIVE FILTERING RECOMMENDATIONS ───────────

    async getCollaborativeRecommendations(userId: string, limit: number = 10): Promise<any[]> {
        const cacheKey = `collab_recs:${userId}`;
        const cached = await this.redisService.getJson<any[]>(cacheKey);
        if (cached && cached.length > 0) return cached;

        // Step 1: Get current user's liked profiles
        const myLikes = await this.likeRepository.find({
            where: { likerId: userId, isLike: true },
            select: ['likedId'],
        });
        const myLikedIds = new Set(myLikes.map(l => l.likedId));
        if (myLikedIds.size === 0) return [];

        // Step 2: Find similar users (users who liked the same profiles)
        const similarUserLikes = await this.likeRepository
            .createQueryBuilder('like')
            .select('like.likerId', 'similarUserId')
            .addSelect('COUNT(*)', 'overlapCount')
            .where('like.likedId IN (:...likedIds)', { likedIds: [...myLikedIds] })
            .andWhere('like.likerId != :userId', { userId })
            .andWhere('like.isLike = :isLike', { isLike: true })
            .groupBy('like.likerId')
            .having('COUNT(*) >= 2')
            .orderBy('COUNT(*)', 'DESC')
            .limit(50)
            .getRawMany();

        if (similarUserLikes.length === 0) return [];

        const similarUserIds = similarUserLikes.map(s => s.similarUserId);

        // Step 3: Get profiles that similar users liked but current user hasn't seen
        const excludeIds = await this.getExcludeIds(userId);

        const collaborativeLikes = await this.likeRepository
            .createQueryBuilder('like')
            .select('like.likedId', 'candidateId')
            .addSelect('COUNT(*)', 'score')
            .where('like.likerId IN (:...similarUserIds)', { similarUserIds })
            .andWhere('like.likedId NOT IN (:...excludeIds)', { excludeIds })
            .andWhere('like.isLike = :isLike', { isLike: true })
            .groupBy('like.likedId')
            .orderBy('COUNT(*)', 'DESC')
            .limit(limit * 2)
            .getRawMany();

        if (collaborativeLikes.length === 0) return [];

        const candidateIds = collaborativeLikes.map(c => c.candidateId);
        const collabScoreMap = new Map(collaborativeLikes.map(c => [c.candidateId, parseInt(c.score, 10)]));

        // Step 4: Fetch profiles and compute blended score (60% compat + 40% collab)
        const profiles = await this.profileRepository
            .createQueryBuilder('profile')
            .leftJoinAndSelect('profile.user', 'user')
            .where('profile.userId IN (:...candidateIds)', { candidateIds })
            .andWhere('user.status = :status', { status: 'active' })
            .getMany();

        const myProfile = await this.profileRepository.findOne({ where: { userId } });

        const scored = profiles.map(p => {
            const compatScore = myProfile ? this.computeCompatibility(myProfile, p) : 50;
            const maxCollabScore = Math.max(...[...collabScoreMap.values()]);
            const normalizedCollab = maxCollabScore > 0
                ? ((collabScoreMap.get(p.userId) || 0) / maxCollabScore) * 100
                : 0;

            const blendedScore = Math.round(compatScore * 0.6 + normalizedCollab * 0.4);
            return { profile: p, score: blendedScore };
        });

        scored.sort((a, b) => b.score - a.score);

        const enriched = await Promise.all(
            scored.slice(0, limit).map(async ({ profile: p, score }) => {
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
                    gender: p.gender,
                    religiousLevel: p.religiousLevel,
                    interests: p.interests,
                    photo: photo?.url || null,
                    recommendationScore: score,
                    source: 'collaborative',
                };
            }),
        );

        await this.redisService.setJson(cacheKey, enriched, 3600); // 1 hour cache
        return enriched;
    }

    // ─── BLENDED RECOMMENDATIONS (Spec: 60% compat + 40% collab) ──

    async getRecommendedForYou(userId: string, limit: number = 10): Promise<any[]> {
        const cacheKey = `recommended:${userId}`;
        const cached = await this.redisService.getJson<any[]>(cacheKey);
        if (cached && cached.length > 0) return cached;

        const [smartSuggestions, collabRecs] = await Promise.all([
            this.getSmartSuggestions(userId, limit),
            this.getCollaborativeRecommendations(userId, limit),
        ]);

        // Merge and deduplicate, prefer collab score when present
        const seen = new Set<string>();
        const merged: any[] = [];

        for (const rec of collabRecs) {
            if (!seen.has(rec.userId)) {
                seen.add(rec.userId);
                merged.push({ ...rec, source: 'recommended' });
            }
        }
        for (const sug of smartSuggestions) {
            if (!seen.has(sug.userId)) {
                seen.add(sug.userId);
                merged.push({ ...sug, source: 'recommended' });
            }
        }

        // Apply diversity filter
        const diversified = this.applyDiversityFilter(merged);
        const result = diversified.slice(0, limit);

        await this.redisService.setJson(cacheKey, result, 3600);
        return result;
    }

    // ─── DIVERSITY FILTER ────────────────────────────────────

    applyDiversityFilter<T extends { city?: string; age?: number; [key: string]: any }>(
        profiles: T[],
    ): T[] {
        if (profiles.length <= 3) return profiles;

        const result: T[] = [];
        const MAX_CONSECUTIVE_SAME_CITY = 3;
        const MAX_CONSECUTIVE_SAME_AGE_BRACKET = 2;

        const getAgeBracket = (age?: number): string => {
            if (!age) return 'unknown';
            if (age < 25) return '18-24';
            if (age < 30) return '25-29';
            if (age < 35) return '30-34';
            if (age < 40) return '35-39';
            return '40+';
        };

        // Group into tiers (top 33%, mid 33%, rest)
        const tierSize = Math.ceil(profiles.length / 3);
        const tiers = [
            profiles.slice(0, tierSize),
            profiles.slice(tierSize, tierSize * 2),
            profiles.slice(tierSize * 2),
        ];

        // Shuffle within each tier for diversity
        for (const tier of tiers) {
            for (let i = tier.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [tier[i], tier[j]] = [tier[j], tier[i]];
            }
        }

        const shuffled = [...tiers[0], ...tiers[1], ...tiers[2]];

        let consecutiveCity = 0;
        let consecutiveAgeBracket = 0;
        let lastCity = '';
        let lastAgeBracket = '';
        const deferred: T[] = [];

        for (const profile of shuffled) {
            const city = (profile.city || '').toLowerCase();
            const ageBracket = getAgeBracket(profile.age);

            const cityOverflow = city === lastCity && consecutiveCity >= MAX_CONSECUTIVE_SAME_CITY;
            const ageOverflow = ageBracket === lastAgeBracket && consecutiveAgeBracket >= MAX_CONSECUTIVE_SAME_AGE_BRACKET;

            if (cityOverflow || ageOverflow) {
                deferred.push(profile);
                continue;
            }

            result.push(profile);

            if (city === lastCity) consecutiveCity++;
            else { consecutiveCity = 1; lastCity = city; }

            if (ageBracket === lastAgeBracket) consecutiveAgeBracket++;
            else { consecutiveAgeBracket = 1; lastAgeBracket = ageBracket; }
        }

        // Append deferred profiles at the end
        result.push(...deferred);
        return result;
    }

    // ─── BARAKA METER ──────────────────────────────────────

    async getBaraka(userId: string, targetUserId: string): Promise<any> {
        const [myProfile, targetProfile] = await Promise.all([
            this.profileRepository.findOne({ where: { userId }, relations: ['user'] }),
            this.profileRepository.findOne({ where: { userId: targetUserId }, relations: ['user'] }),
        ]);
        if (!myProfile || !targetProfile) return { score: 0, level: 'low', breakdown: null };

        const breakdown = this.computeBarakaBreakdown(myProfile, targetProfile);
        const score = breakdown.total;
        const level = score >= 75 ? 'high' : score >= 45 ? 'medium' : 'low';

        return { score, level, breakdown };
    }

    async getBulkBaraka(userId: string, targetUserIds: string[]): Promise<Record<string, { score: number; level: string }>> {
        if (targetUserIds.length === 0) return {};

        const myProfile = await this.profileRepository.findOne({ where: { userId } });
        if (!myProfile) return {};

        const targets = await this.profileRepository
            .createQueryBuilder('profile')
            .where('profile.userId IN (:...ids)', { ids: targetUserIds })
            .getMany();

        const result: Record<string, { score: number; level: string }> = {};
        for (const target of targets) {
            const breakdown = this.computeBarakaBreakdown(myProfile, target);
            const score = breakdown.total;
            result[target.userId] = {
                score,
                level: score >= 75 ? 'high' : score >= 45 ? 'medium' : 'low',
            };
        }
        return result;
    }

    /**
     * Baraka Meter Breakdown (0-100):
     *   Prayer & Faith:    30 pts (prayerFrequency, religiousLevel, sect)
     *   Intentions:        25 pts (marriageIntention, intentMode alignment)
     *   Lifestyle:         20 pts (dietary, alcohol, hijab, living)
     *   Family Values:     15 pts (familyPlans, wantsChildren, familyValues)
     *   Shared Interests:  10 pts
     */
    private computeBarakaBreakdown(a: Profile, b: Profile): {
        prayer: number; intentions: number; lifestyle: number;
        family: number; interests: number; total: number;
    } {
        let prayer = 0;
        let intentions = 0;
        let lifestyle = 0;
        let family = 0;
        let interests = 0;

        // ── Prayer & Faith (30 pts) ──
        // Religious level match (15 pts)
        if (a.religiousLevel && b.religiousLevel) {
            if (a.religiousLevel === b.religiousLevel) prayer += 15;
            else {
                const levels = ['liberal', 'moderate', 'practicing', 'very_practicing'];
                const diff = Math.abs(levels.indexOf(a.religiousLevel) - levels.indexOf(b.religiousLevel));
                if (diff === 1) prayer += 10;
                else if (diff === 2) prayer += 5;
            }
        }
        // Prayer frequency match (10 pts)
        if (a.prayerFrequency && b.prayerFrequency) {
            if (a.prayerFrequency === b.prayerFrequency) prayer += 10;
            else prayer += 4;
        }
        // Sect compatibility (5 pts)
        if (a.sect && b.sect) {
            if (a.sect === b.sect) prayer += 5;
            else prayer += 2;
        }

        // ── Intentions (25 pts) ──
        // Marriage intention match (15 pts)
        if (a.marriageIntention && b.marriageIntention) {
            if (a.marriageIntention === b.marriageIntention) intentions += 15;
            else {
                const serious = ['within_months', 'within_year'];
                const aBoth = serious.includes(a.marriageIntention);
                const bBoth = serious.includes(b.marriageIntention);
                if (aBoth && bBoth) intentions += 12;
                else if (aBoth || bBoth) intentions += 6;
                else intentions += 3;
            }
        }
        // Intent mode alignment (10 pts)
        if ((a as any).intentMode && (b as any).intentMode) {
            if ((a as any).intentMode === (b as any).intentMode) intentions += 10;
            else intentions += 3;
        }

        // ── Lifestyle (20 pts) ──
        let lifestyleMatches = 0;
        let lifestyleChecked = 0;
        if (a.dietary && b.dietary) { lifestyleChecked++; if (a.dietary === b.dietary) lifestyleMatches++; }
        if (a.alcohol && b.alcohol) { lifestyleChecked++; if (a.alcohol === b.alcohol) lifestyleMatches++; }
        if (a.hijabStatus && b.hijabStatus) { lifestyleChecked++; if (a.hijabStatus === b.hijabStatus) lifestyleMatches++; }
        if (a.livingSituation && b.livingSituation) { lifestyleChecked++; if (a.livingSituation === b.livingSituation) lifestyleMatches++; }
        if (a.sleepSchedule && b.sleepSchedule) { lifestyleChecked++; if (a.sleepSchedule === b.sleepSchedule) lifestyleMatches++; }
        if (lifestyleChecked > 0) {
            lifestyle = Math.round((lifestyleMatches / lifestyleChecked) * 20);
        } else {
            lifestyle = 10; // neutral if no data
        }

        // ── Family Values (15 pts) ──
        if (a.familyPlans && b.familyPlans) {
            if (a.familyPlans === b.familyPlans) family += 8;
            else family += 3;
        }
        if (a.wantsChildren === b.wantsChildren) family += 4;
        if (a.familyValues?.length && b.familyValues?.length) {
            const overlap = a.familyValues.filter(v => b.familyValues.includes(v));
            family += Math.min(Math.round((overlap.length / Math.max(a.familyValues.length, b.familyValues.length)) * 3), 3);
        }

        // ── Shared Interests (10 pts) ──
        if (a.interests?.length && b.interests?.length) {
            const overlap = a.interests.filter(i => b.interests.includes(i));
            interests = Math.min(Math.round((overlap.length / Math.max(a.interests.length, b.interests.length)) * 10), 10);
        }

        const total = Math.min(prayer + intentions + lifestyle + family + interests, 100);
        return { prayer, intentions, lifestyle, family, interests, total };
    }

    // ─── ICE BREAKERS ────────────────────────────────────────

    async getIceBreakers(userId: string, targetUserId: string): Promise<string[]> {
        const [myProfile, targetProfile] = await Promise.all([
            this.profileRepository.findOne({ where: { userId } }),
            this.profileRepository.findOne({ where: { userId: targetUserId }, relations: ['user'] }),
        ]);
        if (!myProfile || !targetProfile) return this.getDefaultIceBreakers();

        const breakers: string[] = [];
        const targetName = targetProfile.user?.firstName || 'them';

        // Interest-based breakers
        if (myProfile.interests?.length && targetProfile.interests?.length) {
            const shared = myProfile.interests.filter(i => targetProfile.interests.includes(i));
            if (shared.length > 0) {
                breakers.push(`I noticed we both enjoy ${shared[0]}! What got you into it?`);
                if (shared.length > 1) {
                    breakers.push(`We share a love for ${shared[0]} and ${shared[1]} — that's a great foundation!`);
                }
            }
        }

        // Location-based
        if (myProfile.city && targetProfile.city && myProfile.city.toLowerCase() === targetProfile.city.toLowerCase()) {
            breakers.push(`Salam! I see we're both in ${myProfile.city}. What's your favorite spot here?`);
        }

        // Education-based
        if (myProfile.education && targetProfile.education && myProfile.education === targetProfile.education) {
            breakers.push(`We both have a background in ${myProfile.education.replace('_', ' ')} — what did you study?`);
        }

        // Faith-based (always respectful)
        breakers.push(`Assalamu Alaikum! I'd love to know more about your journey and values.`);
        breakers.push(`Salam! What does a fulfilling day look like for you?`);
        breakers.push(`What's one quality you value most in a life partner?`);

        // Ensure at least 3, max 5
        return breakers.slice(0, 5);
    }

    private getDefaultIceBreakers(): string[] {
        return [
            'Assalamu Alaikum! I would love to get to know you better.',
            'Salam! What does a perfect day look like for you?',
            'What values matter most to you in a partner?',
            'What are you most passionate about in life?',
            'How would your closest friends describe you?',
        ];
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

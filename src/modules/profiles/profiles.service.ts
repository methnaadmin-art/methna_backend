import {
    Injectable,
    NotFoundException,
    ConflictException,
    BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Profile } from '../../database/entities/profile.entity';
import { UserPreference } from '../../database/entities/user-preference.entity';
import { User } from '../../database/entities/user.entity';
import { RedisService } from '../redis/redis.service';
import { CategoriesService } from '../categories/categories.service';
import {
    CreateProfileDto,
    UpdateProfileDto,
    UpdatePreferencesDto,
    UpdatePrivacySettingsDto,
    UpdateLocationDto,
} from './dto/profile.dto';

@Injectable()
export class ProfilesService {
    constructor(
        @InjectRepository(Profile)
        private readonly profileRepository: Repository<Profile>,
        @InjectRepository(UserPreference)
        private readonly preferenceRepository: Repository<UserPreference>,
        private readonly redisService: RedisService,
        private readonly categoriesService: CategoriesService,
    ) { }

    async getProfile(userId: string): Promise<Profile> {
        const cacheKey = `profile:${userId}`;
        const cached = await this.redisService.getJson<Profile>(cacheKey);
        if (cached) return cached;

        const profile = await this.profileRepository.findOne({
            where: { userId },
            relations: ['user'],
        });
        if (!profile) throw new NotFoundException('Profile not found');

        await this.redisService.setJson(cacheKey, profile, 300);
        return profile;
    }

    async createOrUpdateProfile(userId: string, dto: CreateProfileDto | UpdateProfileDto): Promise<Profile> {
        console.log(`[ProfilesService] createOrUpdateProfile for user ${userId}`);
        console.log(`[ProfilesService] Data received: ${JSON.stringify(dto)}`);
        
        let profile = await this.profileRepository.findOne({
            where: { userId },
        });

        if (profile) {
            console.log(`[ProfilesService] Updating existing profile ${profile.id} for user ${userId}`);
            // Defensive merge: only update fields that are NOT undefined.
            // This prevents accidental wiping of data during partial updates.
            Object.keys(dto).forEach(key => {
                const p = profile as Profile;
                if (dto[key] !== undefined) {
                    p[key] = dto[key];
                }
            });
        } else {
            console.log(`[ProfilesService] Creating new profile for user ${userId}`);
            profile = this.profileRepository.create({
                userId,
                ...dto,
            });
        }

        // Calculate profile completion and completeness
        profile.profileCompletionPercentage = this.calculateCompletionPercentage(profile);
        profile.isComplete = profile.profileCompletionPercentage >= 60;

        const saved = await this.profileRepository.save(profile);
        console.log(`[ProfilesService] Profile saved successfully. Completion: ${profile.profileCompletionPercentage}%`);

        // Invalidate cache
        await this.redisService.del(`profile:${userId}`);
        console.log(`[ProfilesService] Cache invalidated for user ${userId}`);

        // Re-evaluate dynamic categories (non-blocking)
        this.categoriesService.evaluateUserCategories(userId).catch(err => {
            console.error(`[ProfilesService] Error evaluating categories: ${err.message}`);
        });

        return saved;
    }

    // ─── Location ───────────────────────────────────────────

    async updateLocation(userId: string, dto: UpdateLocationDto): Promise<Profile> {
        const profile = await this.profileRepository.findOne({ where: { userId } });
        if (!profile) throw new NotFoundException('Profile not found');

        profile.latitude = dto.latitude;
        profile.longitude = dto.longitude;
        if (dto.city) profile.city = dto.city;
        if (dto.country) profile.country = dto.country;

        const saved = await this.profileRepository.save(profile);
        await this.redisService.del(`profile:${userId}`);
        return saved;
    }

    async toggleLocation(userId: string, enabled: boolean): Promise<void> {
        // This updates the User entity locationEnabled field
        // Handled via UserRepository in users module, called from controller
    }

    // ─── Privacy Settings ───────────────────────────────────

    async updatePrivacySettings(userId: string, dto: UpdatePrivacySettingsDto): Promise<Profile> {
        const profile = await this.profileRepository.findOne({ where: { userId } });
        if (!profile) throw new NotFoundException('Profile not found');

        if (dto.showAge !== undefined) profile.showAge = dto.showAge;
        if (dto.showDistance !== undefined) profile.showDistance = dto.showDistance;
        if (dto.showOnlineStatus !== undefined) profile.showOnlineStatus = dto.showOnlineStatus;
        if (dto.showLastSeen !== undefined) profile.showLastSeen = dto.showLastSeen;

        const saved = await this.profileRepository.save(profile);
        await this.redisService.del(`profile:${userId}`);
        return saved;
    }

    // ─── Preferences ────────────────────────────────────────

    async getPreferences(userId: string): Promise<UserPreference> {
        let prefs = await this.preferenceRepository.findOne({
            where: { userId },
        });
        if (!prefs) {
            prefs = this.preferenceRepository.create({ userId });
            await this.preferenceRepository.save(prefs);
        }
        return prefs;
    }

    async updatePreferences(userId: string, dto: UpdatePreferencesDto): Promise<UserPreference> {
        let prefs = await this.preferenceRepository.findOne({
            where: { userId },
        });
        if (!prefs) {
            prefs = this.preferenceRepository.create({ userId, ...dto });
        } else {
            Object.assign(prefs, dto);
        }
        return this.preferenceRepository.save(prefs);
    }

    // ─── Activity Score ─────────────────────────────────────

    async updateActivityScore(userId: string): Promise<void> {
        const profile = await this.profileRepository.findOne({
            where: { userId },
        });
        if (profile) {
            profile.activityScore = Math.min(100, profile.activityScore + 1);
            await this.profileRepository.save(profile);
        }
    }

    // ─── Profile Completion % ───────────────────────────────

    private calculateCompletionPercentage(profile: Profile): number {
        const fields = [
            { value: profile.bio, weight: 10 },
            { value: profile.gender, weight: 10 },
            { value: profile.dateOfBirth, weight: 10 },
            { value: profile.maritalStatus, weight: 5 },
            { value: profile.religiousLevel, weight: 8 },
            { value: profile.ethnicity, weight: 3 },
            { value: profile.nationality, weight: 3 },
            { value: profile.height, weight: 3 },
            { value: profile.weight, weight: 2 },
            { value: profile.jobTitle, weight: 4 },
            { value: profile.education, weight: 4 },
            { value: profile.familyPlans, weight: 5 },
            { value: profile.marriageIntention, weight: 8 },
            { value: profile.communicationStyle, weight: 3 },
            { value: profile.secondWifePreference, weight: 3 },
            { value: profile.city, weight: 5 },
            { value: profile.country, weight: 5 },
            { value: profile.interests && profile.interests.length > 0 ? true : null, weight: 5 },
            { value: profile.languages && profile.languages.length > 0 ? true : null, weight: 3 },
            { value: profile.aboutPartner, weight: 5 },
        ];

        const totalWeight = fields.reduce((sum, f) => sum + f.weight, 0);
        const achievedWeight = fields.reduce((sum, f) => {
            if (f.value !== null && f.value !== undefined && f.value !== '') {
                return sum + f.weight;
            }
            return sum;
        }, 0);

        return Math.round((achievedWeight / totalWeight) * 100);
    }
}

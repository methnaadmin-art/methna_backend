import {
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
    CommunicationStyle,
    IntentMode,
    MarriageIntention,
    Profile,
} from '../../database/entities/profile.entity';
import { UserPreference } from '../../database/entities/user-preference.entity';
import { RedisService } from '../redis/redis.service';
import { CategoriesService } from '../categories/categories.service';
import { TrustSafetyService } from '../trust-safety/trust-safety.service';
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
        private readonly trustSafetyService: TrustSafetyService,
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
        const sanitizedDto = await this.sanitizeProfilePayload(userId, dto);

        let profile = await this.profileRepository.findOne({
            where: { userId },
        });

        if (profile) {
            Object.keys(sanitizedDto).forEach((key) => {
                if (profile && (sanitizedDto as any)[key] !== undefined) {
                    (profile as any)[key] = (sanitizedDto as any)[key];
                }
            });
        } else {
            profile = this.profileRepository.create({
                userId,
                ...sanitizedDto,
            });
        }

        profile.profileCompletionPercentage = this.calculateCompletionPercentage(profile);
        profile.isComplete = profile.profileCompletionPercentage >= 60;

        const saved = await this.profileRepository.save(profile);

        await this.redisService.del(`profile:${userId}`);

        this.categoriesService.evaluateUserCategories(userId).catch((err) => {
            console.error(`[ProfilesService] Error evaluating categories: ${err.message}`);
        });

        return saved;
    }

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

    async updateActivityScore(userId: string): Promise<void> {
        const profile = await this.profileRepository.findOne({
            where: { userId },
        });
        if (profile) {
            profile.activityScore = Math.min(100, profile.activityScore + 1);
            await this.profileRepository.save(profile);
        }
    }

    private calculateCompletionPercentage(profile: Profile): number {
        const fields = [
            { value: profile.bio, weight: 10 },
            { value: profile.gender, weight: 10 },
            { value: profile.dateOfBirth, weight: 10 },
            { value: profile.maritalStatus, weight: 5 },
            { value: profile.religiousLevel, weight: 5 },
            { value: profile.sect, weight: 4 },
            { value: profile.prayerFrequency, weight: 4 },
            { value: profile.ethnicity, weight: 3 },
            { value: profile.nationality, weight: 3 },
            { value: profile.height, weight: 3 },
            { value: profile.weight, weight: 2 },
            { value: profile.jobTitle, weight: 4 },
            { value: profile.education, weight: 4 },
            { value: profile.familyPlans, weight: 5 },
            { value: profile.familyValues && profile.familyValues.length > 0 ? true : null, weight: 4 },
            { value: profile.marriageIntention, weight: 5 },
            { value: profile.communicationStyle, weight: 3 },
            { value: profile.secondWifePreference, weight: 3 },
            { value: profile.city, weight: 3 },
            { value: profile.country, weight: 3 },
            { value: profile.dietary, weight: 2 },
            { value: profile.alcohol, weight: 2 },
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

    private async sanitizeProfilePayload(
        userId: string,
        dto: CreateProfileDto | UpdateProfileDto,
    ): Promise<CreateProfileDto | UpdateProfileDto> {
        const sanitized = { ...dto } as Record<string, any>;

        const normalizedCommunicationStyle = this.normalizeCommunicationStyle(
            sanitized.communicationStyle,
        );
        if (normalizedCommunicationStyle) {
            sanitized.communicationStyle = normalizedCommunicationStyle;
        } else if (sanitized.communicationStyle !== undefined) {
            delete sanitized.communicationStyle;
        }

        const normalizedTimeline = this.normalizeMarriageTimeline(
            sanitized.marriageTimeline ?? sanitized.marriageIntention,
        );
        if (normalizedTimeline) {
            sanitized.marriageIntention = normalizedTimeline;
            if (!sanitized.intentMode) {
                sanitized.intentMode = this.intentModeForMarriageTimeline(
                    normalizedTimeline,
                );
            }
        }
        delete sanitized.marriageTimeline;

        const textFields = [
            'bio',
            'aboutPartner',
            'company',
            'jobTitle',
            'educationDetails',
            'healthNotes',
            'petPreference',
        ];

        for (const field of textFields) {
            const value = sanitized[field];
            if (typeof value === 'string' && value.trim().length > 0) {
                const moderation = await this.trustSafetyService.moderateProfileText(
                    userId,
                    value.trim(),
                    field,
                );
                sanitized[field] = moderation.cleanText;
            }
        }

        const arrayFields = [
            'interests',
            'languages',
            'familyValues',
            'nationalities',
            'favoriteMusic',
            'favoriteMovies',
            'favoriteBooks',
            'travelPreferences',
        ];

        for (const field of arrayFields) {
            const value = sanitized[field];
            if (Array.isArray(value)) {
                sanitized[field] = value
                    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
                    .filter((entry) => entry.length > 0)
                    .filter((entry, index, arr) => arr.indexOf(entry) === index);
            }
        }

        return sanitized as CreateProfileDto | UpdateProfileDto;
    }

    private normalizeCommunicationStyle(value: unknown): CommunicationStyle | null {
        const normalized = String(value ?? '')
            .trim()
            .toLowerCase()
            .replace(/-/g, '_')
            .replace(/\s+/g, '_');

        switch (normalized) {
            case CommunicationStyle.EXPRESSIVE:
            case 'chatty_cathy':
            case 'storyteller':
                return CommunicationStyle.EXPRESSIVE;
            case CommunicationStyle.RESERVED:
            case 'listener':
            case 'deep_thinker':
                return CommunicationStyle.RESERVED;
            case CommunicationStyle.HUMOROUS:
            case 'joker':
            case 'sarcastic_wit':
                return CommunicationStyle.HUMOROUS;
            case CommunicationStyle.GENTLE:
            case 'easygoing':
                return CommunicationStyle.GENTLE;
            case CommunicationStyle.DIRECT:
            case 'straight_shooter':
                return CommunicationStyle.DIRECT;
            default:
                return null;
        }
    }

    private normalizeMarriageTimeline(value: unknown): MarriageIntention | null {
        const normalized = String(value ?? '')
            .trim()
            .toLowerCase()
            .replace(/-/g, '_')
            .replace(/\s+/g, '_');

        switch (normalized) {
            case '1_3_months':
            case MarriageIntention.WITHIN_MONTHS:
                return MarriageIntention.WITHIN_MONTHS;
            case '3_6_months':
            case 'up_to_1_year':
            case MarriageIntention.WITHIN_YEAR:
                return MarriageIntention.WITHIN_YEAR;
            case '1_2_years':
            case MarriageIntention.ONE_TO_TWO_YEARS:
                return MarriageIntention.ONE_TO_TWO_YEARS;
            case MarriageIntention.NOT_SURE:
                return MarriageIntention.NOT_SURE;
            case MarriageIntention.JUST_EXPLORING:
                return MarriageIntention.JUST_EXPLORING;
            default:
                return null;
        }
    }

    private intentModeForMarriageTimeline(value: MarriageIntention): IntentMode {
        switch (value) {
            case MarriageIntention.WITHIN_MONTHS:
                return IntentMode.FAMILY_INTRODUCTION;
            case MarriageIntention.WITHIN_YEAR:
            case MarriageIntention.ONE_TO_TWO_YEARS:
                return IntentMode.SERIOUS_MARRIAGE;
            case MarriageIntention.NOT_SURE:
            case MarriageIntention.JUST_EXPLORING:
            default:
                return IntentMode.EXPLORING;
        }
    }
}

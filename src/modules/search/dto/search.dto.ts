import {
    IsOptional,
    IsEnum,
    IsInt,
    IsString,
    IsBoolean,
    IsNumber,
    Min,
    Max,
    IsArray,
    IsIn,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
    Gender,
    MaritalStatus,
    ReligiousLevel,
    EducationLevel,
    PrayerFrequency,
    MarriageIntention,
    LivingSituation,
    CommunicationStyle,
    IntentMode,
} from '../../../database/entities/profile.entity';

export enum SearchSortBy {
    DISTANCE = 'distance',
    COMPATIBILITY = 'compatibility',
    ACTIVITY = 'activity',
    NEWEST = 'newest',
}

const toStringArray = ({ value }: { value: unknown }): string[] | undefined => {
    if (value == null) return undefined;

    const normalize = (entry: unknown): string => String(entry ?? '').trim();
    const dedupe = (items: unknown[]): string[] =>
        Array.from(new Set(items.map(normalize).filter((item) => item.length > 0)));

    if (Array.isArray(value)) {
        return dedupe(value);
    }

    if (typeof value === 'string') {
        const raw = value.trim();
        if (!raw) return undefined;

        if (raw.startsWith('[') && raw.endsWith(']')) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    return dedupe(parsed);
                }
            } catch {
                // Fall through to comma-split handling.
            }
        }

        return dedupe(raw.split(','));
    }

    return undefined;
};

export class SearchFiltersDto {
    @ApiPropertyOptional({ minimum: 18 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(18)
    minAge?: number;

    @ApiPropertyOptional({ maximum: 100 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Max(100)
    maxAge?: number;

    @ApiPropertyOptional({ enum: Gender })
    @IsOptional()
    @IsEnum(Gender)
    gender?: Gender;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    city?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    country?: string;

    @ApiPropertyOptional({ enum: MaritalStatus })
    @IsOptional()
    @IsEnum(MaritalStatus)
    maritalStatus?: MaritalStatus;

    @ApiPropertyOptional({ enum: ReligiousLevel })
    @IsOptional()
    @IsEnum(ReligiousLevel)
    religiousLevel?: ReligiousLevel;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    ethnicity?: string;

    @ApiPropertyOptional({ enum: EducationLevel })
    @IsOptional()
    @IsEnum(EducationLevel)
    education?: EducationLevel;

    @ApiPropertyOptional({ enum: PrayerFrequency })
    @IsOptional()
    @IsEnum(PrayerFrequency)
    prayerFrequency?: PrayerFrequency;

    @ApiPropertyOptional({ enum: MarriageIntention })
    @IsOptional()
    @IsEnum(MarriageIntention)
    marriageIntention?: MarriageIntention;

    @ApiPropertyOptional({
        enum: MarriageIntention,
        description: 'Time frame alias for relationship timeline filtering',
    })
    @IsOptional()
    @IsEnum(MarriageIntention)
    timeFrame?: MarriageIntention;

    @ApiPropertyOptional({
        enum: IntentMode,
        description: 'Legacy intent mode field kept for backward compatibility',
    })
    @IsOptional()
    @IsEnum(IntentMode)
    intentMode?: IntentMode;

    @ApiPropertyOptional({ enum: LivingSituation })
    @IsOptional()
    @IsEnum(LivingSituation)
    livingSituation?: LivingSituation;

    @ApiPropertyOptional({ type: [String], description: 'Filter by interests' })
    @IsOptional()
    @Transform(toStringArray)
    @IsArray()
    @IsString({ each: true })
    interests?: string[];

    @ApiPropertyOptional({ type: [String], description: 'Filter by spoken languages' })
    @IsOptional()
    @Transform(toStringArray)
    @IsArray()
    @IsString({ each: true })
    languages?: string[];

    @ApiPropertyOptional({ type: [String], description: 'Filter by family values tags' })
    @IsOptional()
    @Transform(toStringArray)
    @IsArray()
    @IsString({ each: true })
    familyValues?: string[];

    @ApiPropertyOptional({ type: [String], description: 'Filter by nationality or dual nationality' })
    @IsOptional()
    @Transform(toStringArray)
    @IsArray()
    @IsString({ each: true })
    nationalities?: string[];

    @ApiPropertyOptional({ type: [CommunicationStyle], description: 'Filter by communication styles (matches any)' })
    @IsOptional()
    @Transform(toStringArray)
    @IsArray()
    @IsString({ each: true })
    communicationStyles?: string[];

    @ApiPropertyOptional({ description: 'Ignore location radius preference and search globally' })
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    goGlobal?: boolean;

    @ApiPropertyOptional({ description: 'Only show verified users' })
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    verifiedOnly?: boolean;

    @ApiPropertyOptional({ description: 'Only show online users' })
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    onlineOnly?: boolean;

    @ApiPropertyOptional({ description: 'Only show recently active users (last 7 days)' })
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    recentlyActiveOnly?: boolean;

    @ApiPropertyOptional({ description: 'Only show profiles with at least one photo' })
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    withPhotosOnly?: boolean;

    @ApiPropertyOptional({ description: 'Minimum trust score (0-100)', minimum: 0, maximum: 100 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    @Max(100)
    minTrustScore?: number;

    @ApiPropertyOptional({ description: 'Background check status filter', enum: ['cleared', 'pending', 'failed'] })
    @IsOptional()
    @IsString()
    @IsIn(['cleared', 'pending', 'failed'])
    backgroundCheckStatus?: string;

    @ApiPropertyOptional({ description: 'Max distance in km (requires user location)' })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    @Max(500)
    maxDistance?: number;

    @ApiPropertyOptional({ description: 'Search text in bio' })
    @IsOptional()
    @IsString()
    q?: string;

    @ApiPropertyOptional({ description: 'Search by name (first or last)' })
    @IsOptional()
    @IsString()
    name?: string;

    @ApiPropertyOptional({ description: 'Force refresh (bypass cache)' })
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    forceRefresh?: boolean;

    @ApiPropertyOptional({ default: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1;

    @ApiPropertyOptional({ description: 'Sort priority: distance (nearest first), compatibility, activity, newest', enum: ['distance', 'compatibility', 'activity', 'newest'], default: 'distance' })
    @IsOptional()
    @IsString()
    @IsIn(['distance', 'compatibility', 'activity', 'newest'])
    sortBy?: SearchSortBy = SearchSortBy.DISTANCE;

    @ApiPropertyOptional({ default: 20 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(50)
    limit?: number = 20;
}

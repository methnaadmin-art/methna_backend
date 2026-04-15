import {
    IsString,
    IsEnum,
    IsOptional,
    IsDate,
    IsBoolean,
    IsInt,
    IsArray,
    IsNumber,
    Min,
    Max,
    MaxLength,
    MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
    Gender,
    MaritalStatus,
    ReligiousLevel,
    LivingSituation,
    EducationLevel,
    FamilyPlans,
    CommunicationStyle,
    MarriageIntention,
    IntentMode,
    SecondWifePreference,
    BloodType,
    WorkoutFrequency,
    SleepSchedule,
    SocialMediaUsage,
    Sect,
    PrayerFrequency,
    DietaryPreference,
    AlcoholUsage,
    HijabStatus,
} from '../../../database/entities/profile.entity';

const normalizeEnumToken = (value: unknown): string =>
    String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/-/g, '_')
        .replace(/\s+/g, '_');

const normalizeCommunicationStyleAlias = (value: unknown): unknown => {
    const normalized = normalizeEnumToken(value);
    switch (normalized) {
        case 'chatty_cathy':
        case 'storyteller':
            return CommunicationStyle.EXPRESSIVE;
        case 'listener':
        case 'deep_thinker':
            return CommunicationStyle.RESERVED;
        case 'joker':
        case 'sarcastic_wit':
            return CommunicationStyle.HUMOROUS;
        case 'easygoing':
            return CommunicationStyle.GENTLE;
        case 'straight_shooter':
            return CommunicationStyle.DIRECT;
        default:
            return normalized;
    }
};

const normalizeMarriageTimelineAlias = (value: unknown): unknown => {
    const normalized = normalizeEnumToken(value);
    switch (normalized) {
        case '1_3_months':
        case 'within_months':
            return MarriageIntention.WITHIN_MONTHS;
        case '3_6_months':
        case 'up_to_1_year':
        case 'within_year':
            return MarriageIntention.WITHIN_YEAR;
        case '1_2_years':
        case 'one_to_two_years':
            return MarriageIntention.ONE_TO_TWO_YEARS;
        case 'not_sure':
            return MarriageIntention.NOT_SURE;
        case 'just_exploring':
            return MarriageIntention.JUST_EXPLORING;
        default:
            return normalized;
    }
};

export class CreateProfileDto {
    @ApiPropertyOptional({ maxLength: 500 })
    @IsOptional()
    @IsString()
    @MaxLength(500)
    bio?: string;

    @ApiProperty({ enum: Gender })
    @IsEnum(Gender)
    gender: Gender;

    @ApiProperty({ example: '1995-01-15' })
    @Type(() => Date)
    @IsDate()
    dateOfBirth: Date;

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

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    nationality?: string;

    @ApiPropertyOptional({ type: [String], description: 'Up to 3 nationalities' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    nationalities?: string[];

    @ApiPropertyOptional({ enum: Sect })
    @IsOptional()
    @IsEnum(Sect)
    sect?: Sect;

    @ApiPropertyOptional({ enum: PrayerFrequency })
    @IsOptional()
    @IsEnum(PrayerFrequency)
    prayerFrequency?: PrayerFrequency;

    @ApiPropertyOptional({ enum: DietaryPreference })
    @IsOptional()
    @IsEnum(DietaryPreference)
    dietary?: DietaryPreference;

    @ApiPropertyOptional({ enum: AlcoholUsage })
    @IsOptional()
    @IsEnum(AlcoholUsage)
    alcohol?: AlcoholUsage;

    @ApiPropertyOptional({ enum: HijabStatus, description: 'For females only' })
    @IsOptional()
    @IsEnum(HijabStatus)
    hijabStatus?: HijabStatus;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    company?: string;

    @ApiPropertyOptional({ type: [String], description: 'Family values tags' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    familyValues?: string[];

    // Extended fields

    @ApiPropertyOptional({ minimum: 100, maximum: 250, description: 'Height in cm' })
    @IsOptional()
    @IsInt()
    @Min(100)
    @Max(250)
    height?: number;

    @ApiPropertyOptional({ minimum: 30, maximum: 300, description: 'Weight in kg' })
    @IsOptional()
    @IsInt()
    @Min(30)
    @Max(300)
    weight?: number;

    @ApiPropertyOptional({ enum: LivingSituation })
    @IsOptional()
    @IsEnum(LivingSituation)
    livingSituation?: LivingSituation;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    jobTitle?: string;

    @ApiPropertyOptional({ enum: EducationLevel })
    @IsOptional()
    @IsEnum(EducationLevel)
    education?: EducationLevel;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    educationDetails?: string;

    @ApiPropertyOptional({ enum: FamilyPlans })
    @IsOptional()
    @IsEnum(FamilyPlans)
    familyPlans?: FamilyPlans;

    @ApiPropertyOptional({ enum: CommunicationStyle })
    @IsOptional()
    @Transform(({ value }) => normalizeCommunicationStyleAlias(value))
    @IsEnum(CommunicationStyle)
    communicationStyle?: CommunicationStyle;

    @ApiPropertyOptional({ enum: MarriageIntention })
    @IsOptional()
    @Transform(({ value }) => normalizeMarriageTimelineAlias(value))
    @IsEnum(MarriageIntention)
    marriageIntention?: MarriageIntention;

    @ApiPropertyOptional({
        enum: MarriageIntention,
        description: 'Legacy timeline alias from older clients',
    })
    @IsOptional()
    @Transform(({ value }) => normalizeMarriageTimelineAlias(value))
    @IsEnum(MarriageIntention)
    marriageTimeline?: MarriageIntention;

    @ApiPropertyOptional({ enum: IntentMode })
    @IsOptional()
    @IsEnum(IntentMode)
    intentMode?: IntentMode;

    @ApiPropertyOptional({ enum: SecondWifePreference })
    @IsOptional()
    @IsEnum(SecondWifePreference)
    secondWifePreference?: SecondWifePreference;

    // Health & Body

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    vaccinationStatus?: boolean;

    @ApiPropertyOptional({ enum: BloodType })
    @IsOptional()
    @IsEnum(BloodType)
    bloodType?: BloodType;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    healthNotes?: string;

    // Lifestyle

    @ApiPropertyOptional({ enum: WorkoutFrequency })
    @IsOptional()
    @IsEnum(WorkoutFrequency)
    workoutFrequency?: WorkoutFrequency;

    @ApiPropertyOptional({ enum: SleepSchedule })
    @IsOptional()
    @IsEnum(SleepSchedule)
    sleepSchedule?: SleepSchedule;

    @ApiPropertyOptional({ enum: SocialMediaUsage })
    @IsOptional()
    @IsEnum(SocialMediaUsage)
    socialMediaUsage?: SocialMediaUsage;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    hasPets?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    petPreference?: string;

    // Preferences & Hobbies

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    interests?: string[];

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    languages?: string[];

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    favoriteMusic?: string[];

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    favoriteMovies?: string[];

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    favoriteBooks?: string[];

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    travelPreferences?: string[];

    // Family

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    hasChildren?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsInt()
    @Min(0)
    numberOfChildren?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    wantsChildren?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    willingToRelocate?: boolean;

    // Location

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    city?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    country?: string;

    // About partner

    @ApiPropertyOptional({ maxLength: 1000 })
    @IsOptional()
    @IsString()
    @MaxLength(1000)
    aboutPartner?: string;
}

export class UpdateProfileDto extends PartialType(CreateProfileDto) { }

export class UpdatePrivacySettingsDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    showAge?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    showDistance?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    showOnlineStatus?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    showLastSeen?: boolean;
}

export class UpdateLocationDto {
    @ApiProperty({ description: 'Latitude', example: 24.7136 })
    @IsNumber()
    latitude: number;

    @ApiProperty({ description: 'Longitude', example: 46.6753 })
    @IsNumber()
    longitude: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    city?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    country?: string;
}

export class UpdatePreferencesDto {
    @ApiPropertyOptional({ minimum: 18 })
    @IsOptional()
    @IsInt()
    @Min(18)
    minAge?: number;

    @ApiPropertyOptional({ maximum: 100 })
    @IsOptional()
    @IsInt()
    @Max(100)
    maxAge?: number;

    @ApiPropertyOptional({ enum: Gender })
    @IsOptional()
    @IsEnum(Gender)
    preferredGender?: Gender;

    @ApiPropertyOptional({ minimum: 1, maximum: 500, description: 'Max distance in km' })
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(500)
    maxDistance?: number;

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    preferredEthnicities?: string[];

    @ApiPropertyOptional({ enum: ReligiousLevel })
    @IsOptional()
    @IsEnum(ReligiousLevel)
    preferredReligiousLevel?: ReligiousLevel;

    @ApiPropertyOptional({ enum: MaritalStatus })
    @IsOptional()
    @IsEnum(MaritalStatus)
    preferredMaritalStatus?: MaritalStatus;

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    preferredNationalities?: string[];

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    preferredInterests?: string[];

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    preferredLanguages?: string[];

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    preferredFamilyValues?: string[];

    @ApiPropertyOptional({ enum: MarriageIntention })
    @IsOptional()
    @IsEnum(MarriageIntention)
    preferredMarriageIntention?: MarriageIntention;

    @ApiPropertyOptional({ enum: SecondWifePreference })
    @IsOptional()
    @IsEnum(SecondWifePreference)
    preferredSecondWifePreference?: SecondWifePreference;
}




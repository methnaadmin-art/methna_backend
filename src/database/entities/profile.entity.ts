import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    OneToOne,
    JoinColumn,
    Index,
} from 'typeorm';
import { User } from './user.entity';

export enum Gender {
    MALE = 'male',
    FEMALE = 'female',
}

export enum MaritalStatus {
    NEVER_MARRIED = 'never_married',
    DIVORCED = 'divorced',
    WIDOWED = 'widowed',
    MARRIED = 'married',
}

export enum ReligiousLevel {
    VERY_PRACTICING = 'very_practicing',
    PRACTICING = 'practicing',
    MODERATE = 'moderate',
    LIBERAL = 'liberal',
}

export enum LivingSituation {
    ALONE = 'alone',
    WITH_FAMILY = 'with_family',
    WITH_ROOMMATES = 'with_roommates',
    WITH_SPOUSE = 'with_spouse',
}

export enum EducationLevel {
    HIGH_SCHOOL = 'high_school',
    BACHELORS = 'bachelors',
    MASTERS = 'masters',
    DOCTORATE = 'doctorate',
    ISLAMIC_STUDIES = 'islamic_studies',
    OTHER = 'other',
}

export enum FamilyPlans {
    WANTS_CHILDREN = 'wants_children',
    DOESNT_WANT = 'doesnt_want',
    OPEN_TO_IT = 'open_to_it',
    HAS_AND_WANTS_MORE = 'has_and_wants_more',
    HAS_AND_DONE = 'has_and_done',
}

export enum CommunicationStyle {
    DIRECT = 'direct',
    GENTLE = 'gentle',
    HUMOROUS = 'humorous',
    RESERVED = 'reserved',
    EXPRESSIVE = 'expressive',
}

export enum MarriageIntention {
    WITHIN_MONTHS = 'within_months',
    WITHIN_YEAR = 'within_year',
    ONE_TO_TWO_YEARS = 'one_to_two_years',
    NOT_SURE = 'not_sure',
    JUST_EXPLORING = 'just_exploring',
}

export enum SecondWifePreference {
    OPEN = 'open',
    NOT_OPEN = 'not_open',
    ALREADY_MARRIED = 'already_married',
    PREFER_NOT_TO_SAY = 'prefer_not_to_say',
}

export enum IntentMode {
    SERIOUS_MARRIAGE = 'serious_marriage',
    EXPLORING = 'exploring',
    FAMILY_INTRODUCTION = 'family_introduction',
}

export enum BloodType {
    A_POSITIVE = 'A+',
    A_NEGATIVE = 'A-',
    B_POSITIVE = 'B+',
    B_NEGATIVE = 'B-',
    AB_POSITIVE = 'AB+',
    AB_NEGATIVE = 'AB-',
    O_POSITIVE = 'O+',
    O_NEGATIVE = 'O-',
}

export enum WorkoutFrequency {
    DAILY = 'daily',
    SEVERAL_TIMES_WEEK = 'several_times_week',
    ONCE_A_WEEK = 'once_a_week',
    RARELY = 'rarely',
    NEVER = 'never',
}

export enum SleepSchedule {
    EARLY_BIRD = 'early_bird',
    NIGHT_OWL = 'night_owl',
    FLEXIBLE = 'flexible',
}

export enum SocialMediaUsage {
    VERY_ACTIVE = 'very_active',
    MODERATE = 'moderate',
    MINIMAL = 'minimal',
    NONE = 'none',
}

export enum Sect {
    SUNNI = 'sunni',
    SHIA = 'shia',
    SUFI = 'sufi',
    OTHER = 'other',
    PREFER_NOT_TO_SAY = 'prefer_not_to_say',
}

export enum PrayerFrequency {
    ACTIVELY_PRACTICING = 'actively_practicing',
    OCCASIONALLY = 'occasionally',
    NOT_PRACTICING = 'not_practicing',
}

export enum DietaryPreference {
    HALAL = 'halal',
    NON_STRICT = 'non_strict',
}

export enum AlcoholUsage {
    DOESNT_DRINK = 'doesnt_drink',
    DRINKS = 'drinks',
}

export enum HijabStatus {
    COVERED = 'covered',
    NIQAB = 'niqab',
    NOT_COVERED = 'not_covered',
}

@Entity('profiles')
export class Profile {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column()
    userId: string;

    @OneToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user: User;

    // --- Basic Info ---

    @Column({ nullable: true, length: 500 })
    bio: string;

    @Index()
    @Column({ type: 'enum', enum: Gender })
    gender: Gender;

    @Index()
    @Column({ type: 'date' })
    dateOfBirth: Date;

    @Index()
    @Column({ type: 'enum', enum: MaritalStatus, default: MaritalStatus.NEVER_MARRIED })
    maritalStatus: MaritalStatus;

    @Index()
    @Column({ type: 'enum', enum: ReligiousLevel, default: ReligiousLevel.PRACTICING })
    religiousLevel: ReligiousLevel;

    @Column({ nullable: true })
    ethnicity: string;

    @Column({ nullable: true })
    nationality: string;

    @Column({ type: 'simple-array', nullable: true })
    nationalities: string[]; // up to 3

    @Column({ type: 'enum', enum: Sect, nullable: true })
    sect: Sect;

    @Column({ type: 'enum', enum: PrayerFrequency, nullable: true })
    prayerFrequency: PrayerFrequency;

    @Column({ type: 'enum', enum: DietaryPreference, nullable: true })
    dietary: DietaryPreference;

    @Column({ type: 'enum', enum: AlcoholUsage, nullable: true })
    alcohol: AlcoholUsage;

    @Column({ type: 'enum', enum: HijabStatus, nullable: true })
    hijabStatus: HijabStatus; // for females only

    @Column({ nullable: true })
    company: string;

    @Column({ type: 'simple-array', nullable: true })
    familyValues: string[]; // e.g. ['strong_family_bonds', 'desires_children', 'shared_responsibilities']

    // --- Extended Profile ---

    @Column({ type: 'int', nullable: true })
    height: number; // in cm

    @Column({ type: 'int', nullable: true })
    weight: number; // in kg

    @Index()
    @Column({ type: 'enum', enum: LivingSituation, nullable: true })
    livingSituation: LivingSituation;

    @Column({ nullable: true })
    jobTitle: string;

    @Index()
    @Column({ type: 'enum', enum: EducationLevel, nullable: true })
    education: EducationLevel;

    @Column({ nullable: true })
    educationDetails: string;

    @Column({ type: 'enum', enum: FamilyPlans, nullable: true })
    familyPlans: FamilyPlans;

    @Column({ type: 'enum', enum: CommunicationStyle, nullable: true })
    communicationStyle: CommunicationStyle;

    @Index()
    @Column({ type: 'enum', enum: MarriageIntention, nullable: true })
    marriageIntention: MarriageIntention;

    @Column({ type: 'enum', enum: SecondWifePreference, nullable: true })
    secondWifePreference: SecondWifePreference;

    @Column({ type: 'enum', enum: IntentMode, default: IntentMode.SERIOUS_MARRIAGE })
    intentMode: IntentMode;

    // Health & Body
    @Column({ default: false })
    vaccinationStatus: boolean;

    @Column({ type: 'enum', enum: BloodType, nullable: true })
    bloodType: BloodType;

    @Column({ nullable: true })
    healthNotes: string;

    // Lifestyle
    @Column({ type: 'enum', enum: WorkoutFrequency, nullable: true })
    workoutFrequency: WorkoutFrequency;

    @Column({ type: 'enum', enum: SleepSchedule, nullable: true })
    sleepSchedule: SleepSchedule;

    @Column({ type: 'enum', enum: SocialMediaUsage, nullable: true })
    socialMediaUsage: SocialMediaUsage;

    @Column({ default: false })
    hasPets: boolean;

    @Column({ nullable: true })
    petPreference: string;

    // Preferences & Hobbies
    @Column({ type: 'simple-array', nullable: true })
    interests: string[];

    @Column({ type: 'simple-array', nullable: true })
    languages: string[];

    @Column({ type: 'simple-array', nullable: true })
    favoriteMusic: string[];

    @Column({ type: 'simple-array', nullable: true })
    favoriteMovies: string[];

    @Column({ type: 'simple-array', nullable: true })
    favoriteBooks: string[];

    @Column({ type: 'simple-array', nullable: true })
    travelPreferences: string[];

    // Family
    @Column({ default: false })
    hasChildren: boolean;

    @Column({ type: 'int', default: 0 })
    numberOfChildren: number;

    @Column({ default: false })
    wantsChildren: boolean;

    @Column({ default: false })
    willingToRelocate: boolean;

    // Location
    @Index()
    @Column({ nullable: true })
    city: string;

    @Index()
    @Column({ nullable: true })
    country: string;

    @Index()
    @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
    latitude: number;

    @Index()
    @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
    longitude: number;

    // About partner
    @Column({ nullable: true, length: 1000 })
    aboutPartner: string;

    // Privacy settings
    @Column({ default: true })
    showAge: boolean;

    @Column({ default: true })
    showDistance: boolean;

    @Column({ default: true })
    showOnlineStatus: boolean;

    @Column({ default: true })
    showLastSeen: boolean;

    // Scoring
    @Column({ type: 'float', default: 0 })
    profileCompletionPercentage: number;

    @Column({ type: 'float', default: 0 })
    activityScore: number;

    @Column({ default: false })
    isComplete: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

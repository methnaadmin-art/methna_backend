import { Profile } from './profile.entity';
import { Photo } from './photo.entity';
import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    DeleteDateColumn,
    OneToOne,
    OneToMany,
    Index,
} from 'typeorm';

export enum UserRole {
    USER = 'user',
    ADMIN = 'admin',
    MODERATOR = 'moderator',
}

export enum UserStatus {
    ACTIVE = 'active',
    LIMITED = 'limited',
    SUSPENDED = 'suspended',
    SHADOW_SUSPENDED = 'shadow_suspended',
    BANNED = 'banned',
    REJECTED = 'rejected',
    DEACTIVATED = 'deactivated',
    CLOSED = 'closed',
    PENDING_VERIFICATION = 'pending_verification',
}

export enum ModerationReasonCode {
    IDENTITY_VERIFICATION_FAILED = 'IDENTITY_VERIFICATION_FAILED',
    SELFIE_VERIFICATION_FAILED = 'SELFIE_VERIFICATION_FAILED',
    MARRIAGE_DOCUMENT_REQUIRED = 'MARRIAGE_DOCUMENT_REQUIRED',
    INAPPROPRIATE_LANGUAGE = 'INAPPROPRIATE_LANGUAGE',
    HARASSMENT_REPORT = 'HARASSMENT_REPORT',
    MULTIPLE_USER_REPORTS = 'MULTIPLE_USER_REPORTS',
    FAKE_PROFILE_SUSPECTED = 'FAKE_PROFILE_SUSPECTED',
    SPAM_BEHAVIOR = 'SPAM_BEHAVIOR',
    POLICY_VIOLATION = 'POLICY_VIOLATION',
    UNDER_REVIEW = 'UNDER_REVIEW',
    OTHER = 'OTHER',
}

export enum ActionRequired {
    REUPLOAD_IDENTITY_DOCUMENT = 'REUPLOAD_IDENTITY_DOCUMENT',
    RETAKE_SELFIE = 'RETAKE_SELFIE',
    UPLOAD_MARRIAGE_DOCUMENT = 'UPLOAD_MARRIAGE_DOCUMENT',
    CONTACT_SUPPORT = 'CONTACT_SUPPORT',
    WAIT_FOR_REVIEW = 'WAIT_FOR_REVIEW',
    NO_ACTION = 'NO_ACTION',
    VERIFY_PHONE = 'VERIFY_PHONE',
    VERIFY_EMAIL = 'VERIFY_EMAIL',
}

export enum VerificationStatus {
    NOT_SUBMITTED = 'not_submitted',
    PENDING = 'pending',
    APPROVED = 'approved',
    REJECTED = 'rejected',
}

export interface UserVerificationItem {
    status: VerificationStatus;
    url: string | null;
    rejectionReason: string | null;
    submittedAt: string | null;
    reviewedAt: string | null;
    reviewedBy: string | null;
}

export interface UserVerificationState {
    selfie: UserVerificationItem;
    identity: UserVerificationItem;
    marital_status: UserVerificationItem;
}

export function createVerificationItem(
    status: VerificationStatus = VerificationStatus.NOT_SUBMITTED,
): UserVerificationItem {
    return {
        status,
        url: null,
        rejectionReason: null,
        submittedAt: null,
        reviewedAt: null,
        reviewedBy: null,
    };
}

export function createDefaultVerificationState(): UserVerificationState {
    return {
        selfie: createVerificationItem(),
        identity: createVerificationItem(),
        marital_status: createVerificationItem(),
    };
}

function isVerificationStatus(value: unknown): value is VerificationStatus {
    if (value === 'not_uploaded') return true; // legacy compat
    return Object.values(VerificationStatus).includes(value as VerificationStatus);
}

/** Map legacy DB value 'not_uploaded' → 'not_submitted'; pass-through valid statuses. */
function migrateLegacyStatus(value: unknown): VerificationStatus | null {
    if (value === 'not_uploaded') return VerificationStatus.NOT_SUBMITTED;
    if (Object.values(VerificationStatus).includes(value as VerificationStatus)) {
        return value as VerificationStatus;
    }
    return null;
}

function normalizeVerificationItem(
    value: Partial<UserVerificationItem> | VerificationStatus | string | null | undefined,
    defaults: UserVerificationItem,
): UserVerificationItem {
    if (typeof value === 'string') {
        return {
            ...defaults,
            status: migrateLegacyStatus(value) ?? defaults.status,
        };
    }

    const normalized = {
        ...defaults,
        ...(value ?? {}),
    };

    return {
        ...normalized,
        status: migrateLegacyStatus(normalized.status) ?? defaults.status,
    };
}

export function normalizeVerificationState(
    verification?:
        | Partial<{
              selfie: Partial<UserVerificationItem> | VerificationStatus | string | null;
              identity: Partial<UserVerificationItem> | VerificationStatus | string | null;
              marital_status: Partial<UserVerificationItem> | VerificationStatus | string | null;
          }>
        | null,
): UserVerificationState {
    const defaults = createDefaultVerificationState();

    return {
        selfie: normalizeVerificationItem(verification?.selfie, defaults.selfie),
        identity: normalizeVerificationItem(verification?.identity, defaults.identity),
        marital_status: normalizeVerificationItem(verification?.marital_status, defaults.marital_status),
    };
}

@Entity('users')
export class User {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index({ unique: true })
    @Column({ unique: true, nullable: true })
    username: string;

    @Index({ unique: true })
    @Column({ unique: true })
    email: string;

    @Column({ select: false })
    password: string;

    @Column()
    firstName: string;

    @Column()
    lastName: string;

    @Index()
    @Column({ nullable: true })
    phone: string;

    @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
    role: UserRole;

    @Column({ type: 'enum', enum: UserStatus, default: UserStatus.PENDING_VERIFICATION })
    status: UserStatus;

    @Column({ type: 'text', nullable: true })
    statusReason: string | null;

    @Column({ type: 'enum', enum: ModerationReasonCode, nullable: true })
    moderationReasonCode: ModerationReasonCode | null;

    @Column({ type: 'text', nullable: true })
    moderationReasonText: string | null;

    @Column({ type: 'enum', enum: ActionRequired, nullable: true })
    actionRequired: ActionRequired | null;

    @Column({ type: 'text', nullable: true })
    supportMessage: string | null;

    @Column({ default: true })
    isUserVisible: boolean;

    @Column({ type: 'timestamptz', nullable: true })
    moderationExpiresAt: Date | null;

    @Column({ type: 'text', nullable: true })
    internalAdminNote: string | null;

    @Column({ type: 'varchar', nullable: true })
    updatedByAdminId: string | null;

    @Column({ default: false })
    isPremium: boolean;

    @Column({ type: 'timestamptz', nullable: true })
    premiumStartDate: Date | null;

    @Column({ type: 'timestamptz', nullable: true })
    premiumExpiryDate: Date | null;

    @Index()
    @Column({ type: 'varchar', nullable: true })
    subscriptionPlanId: string | null;

    @Column({ default: false })
    isGhostModeEnabled: boolean;

    @Column({ default: false })
    isPassportActive: boolean;

    @Column({ type: 'jsonb', nullable: true })
    realLocation: {
        latitude?: number;
        longitude?: number;
        city?: string;
        country?: string;
    } | null;

    @Column({ type: 'jsonb', nullable: true })
    passportLocation: {
        latitude?: number;
        longitude?: number;
        city?: string;
        country?: string;
    } | null;

    @Column({ type: 'jsonb', nullable: true, default: () => "'{}'" })
    verification: UserVerificationState;

    @Column({ nullable: true, select: false })
    refreshToken: string;

    @Column({ default: false })
    emailVerified: boolean;

    // Legacy field kept in the app contract, but not mapped to Postgres because
    // the production database does not have this column.
    phoneVerified?: boolean;

    // OTP fields
    @Column({ nullable: true, select: false })
    otpCode: string;

    @Column({ nullable: true, select: false })
    otpExpiresAt: Date;

    @Column({ type: 'int', default: 0, select: false })
    otpAttempts: number;

    @Column({ nullable: true, select: false })
    otpCooldownUntil: Date;

    // Password reset
    @Column({ nullable: true, select: false })
    resetOtpCode: string;

    @Column({ nullable: true, select: false })
    resetOtpExpiresAt: Date;

    @Column({ type: 'int', default: 0, select: false })
    resetOtpAttempts: number;

    // Selfie verification
    @Column({ default: false })
    selfieVerified: boolean;

    @Column({ nullable: true })
    selfieUrl: string;

    // Document verification (passport, national ID, etc.)
    @Column({ nullable: true })
    documentUrl: string;

    @Column({ nullable: true })
    documentType: string; // 'passport' | 'national_id' | 'driving_license' | 'other'

    @Column({ default: false })
    documentVerified: boolean;

    @Column({ type: 'timestamptz', nullable: true })
    documentVerifiedAt: Date | null;

    @Column({ type: 'text', nullable: true })
    documentRejectionReason: string | null;

    @Column({ type: 'varchar', nullable: true })
    backgroundCheckStatus: string | null;

    @Column({ type: 'varchar', nullable: true })
    backgroundCheckCheckId: string | null;

    @Column({ type: 'timestamptz', nullable: true })
    backgroundCheckCompletedAt: Date | null;

    // FCM push token
    @Column({ nullable: true })
    fcmToken: string;

    // Notification settings
    @Column({ default: true })
    notificationsEnabled: boolean;

    @Column({ default: true })
    matchNotifications: boolean;

    @Column({ default: true })
    messageNotifications: boolean;

    @Column({ default: true })
    likeNotifications: boolean;

    @Column({ default: false })
    profileVisitorNotifications: boolean;

    @Column({ default: false })
    eventsNotifications: boolean;

    @Column({ default: true })
    safetyAlertNotifications: boolean;

    @Column({ default: false })
    promotionsNotifications: boolean;

    @Column({ default: false })
    inAppRecommendationNotifications: boolean;

    @Column({ default: false })
    weeklySummaryNotifications: boolean;

    @Column({ default: true })
    connectionRequestNotifications: boolean;

    @Column({ default: false })
    surveyNotifications: boolean;

    // Chat settings
    @Column({ default: true })
    readReceipts: boolean;

    @Column({ default: true })
    typingIndicator: boolean;

    @Column({ default: true })
    autoDownloadMedia: boolean;

    @Column({ default: true })
    receiveDMs: boolean;

    // Location toggle
    @Column({ default: false })
    locationEnabled: boolean;

    // Profile boost
    @Column({ type: 'timestamptz', nullable: true })
    boostedUntil: Date;

    // Trust & Safety
    @Column({ default: false })
    isShadowBanned: boolean;

    @Column({ type: 'float', default: 100 })
    trustScore: number; // 0-100, starts at 100

    @Column({ type: 'int', default: 0 })
    flagCount: number;

    @Column({ nullable: true })
    lastKnownIp: string;

    @Column({ type: 'int', default: 0 })
    deviceCount: number;

    @Column({ type: 'timestamptz', nullable: true })
    lastLoginAt: Date;

    // Stripe Customer ID
    @Column({ nullable: true, select: false })
    stripeCustomerId: string;

    // Consumable balances (incremented by consumable purchases, decremented by usage)
    @Column({ type: 'int', default: 0 })
    likesBalance: number;

    @Column({ type: 'int', default: 0 })
    complimentsBalance: number;

    @Column({ type: 'int', default: 0 })
    boostsBalance: number;

    @CreateDateColumn()
    createdAt: Date;

    @OneToOne(() => Profile, (profile) => profile.user)
    profile: Profile;

    @OneToMany(() => Photo, (photo) => photo.user)
    photos: Photo[];

    @UpdateDateColumn()
    updatedAt: Date;

    @DeleteDateColumn()
    deletedAt: Date;
}

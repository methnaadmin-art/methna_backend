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
    SUSPENDED = 'suspended',
    BANNED = 'banned',
    DEACTIVATED = 'deactivated',
    PENDING_VERIFICATION = 'pending_verification',
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

    // Legacy background-check fields are intentionally not mapped because the
    // production database does not currently have these columns.
    backgroundCheckStatus?: string;

    backgroundCheckCheckId?: string;

    backgroundCheckCompletedAt?: Date;

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

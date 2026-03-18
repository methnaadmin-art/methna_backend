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

    // Location toggle
    @Column({ default: false })
    locationEnabled: boolean;

    // Profile boost
    @Column({ nullable: true })
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

    @Column({ nullable: true })
    lastLoginAt: Date;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @DeleteDateColumn()
    deletedAt: Date;
}

import { Photo } from './photo.entity';
import { Profile } from './profile.entity';
import {
    Column,
    CreateDateColumn,
    DeleteDateColumn,
    Entity,
    Index,
    OneToMany,
    OneToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
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
        marital_status: createVerificationItem(),
    };
}

function migrateLegacyStatus(value: unknown): VerificationStatus | null {
    if (value === 'not_uploaded') {
        return VerificationStatus.NOT_SUBMITTED;
    }

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
              marital_status: Partial<UserVerificationItem> | VerificationStatus | string | null;
          }>
        | null,
): UserVerificationState {
    const defaults = createDefaultVerificationState();

    return {
        selfie: normalizeVerificationItem(verification?.selfie, defaults.selfie),
        marital_status: normalizeVerificationItem(
            verification?.marital_status,
            defaults.marital_status,
        ),
    };
}

@Entity('users')
export class User {
    @PrimaryGeneratedColumn('uuid')
    id: string;

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

    @Column({ type: 'enum', enum: UserStatus, default: UserStatus.ACTIVE })
    status: UserStatus;

    @Column({ nullable: true, select: false })
    refreshToken: string;

    @Column({ default: false })
    emailVerified: boolean;

    @Column({ default: false })
    selfieVerified: boolean;

    @Column({ nullable: true })
    selfieUrl: string | null;

    @Column({ nullable: true })
    documentUrl: string | null;

    @Column({ nullable: true })
    documentType: string | null;

    @Column({ default: false })
    documentVerified: boolean;

    @Column({ type: 'timestamptz', nullable: true })
    documentVerifiedAt: Date | null;

    @Column({ type: 'text', nullable: true })
    documentRejectionReason: string | null;

    @Column({ type: 'jsonb', nullable: true, default: () => "'{}'" })
    verification: UserVerificationState;

    @Column({ nullable: true })
    lastLoginAt: Date;

    @OneToOne(() => Profile, (profile) => profile.user)
    profile?: Profile;

    @OneToMany(() => Photo, (photo) => photo.user)
    photos?: Photo[];

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @DeleteDateColumn()
    deletedAt: Date;
}

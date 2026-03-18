import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    ManyToOne,
    JoinColumn,
    Index,
} from 'typeorm';
import { User } from './user.entity';

export enum ContentFlagType {
    BAD_WORD = 'bad_word',
    OFFENSIVE = 'offensive',
    SPAM = 'spam',
    HARASSMENT = 'harassment',
    INAPPROPRIATE_PHOTO = 'inappropriate_photo',
    FAKE_PROFILE = 'fake_profile',
}

export enum ContentFlagStatus {
    PENDING = 'pending',
    REVIEWED = 'reviewed',
    DISMISSED = 'dismissed',
    ACTION_TAKEN = 'action_taken',
}

export enum ContentFlagSource {
    AUTO_DETECTED = 'auto_detected',
    USER_REPORT = 'user_report',
    ADMIN_FLAG = 'admin_flag',
}

@Entity('content_flags')
export class ContentFlag {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column()
    userId: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user: User;

    @Column({ type: 'enum', enum: ContentFlagType })
    type: ContentFlagType;

    @Column({ type: 'enum', enum: ContentFlagStatus, default: ContentFlagStatus.PENDING })
    status: ContentFlagStatus;

    @Column({ type: 'enum', enum: ContentFlagSource, default: ContentFlagSource.AUTO_DETECTED })
    source: ContentFlagSource;

    @Column({ type: 'text', nullable: true })
    content: string; // the flagged content

    @Column({ nullable: true })
    entityType: string; // 'message', 'profile', 'photo'

    @Column({ nullable: true })
    entityId: string;

    @Column({ type: 'float', nullable: true })
    confidenceScore: number; // 0-1 AI confidence

    @Column({ nullable: true })
    reviewedById: string;

    @Column({ nullable: true })
    reviewNote: string;

    @CreateDateColumn()
    createdAt: Date;
}

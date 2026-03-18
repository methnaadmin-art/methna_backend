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

export enum PhotoModerationStatus {
    PENDING = 'pending',
    APPROVED = 'approved',
    REJECTED = 'rejected',
    FLAGGED = 'flagged',
}

@Entity('photos')
export class Photo {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column()
    userId: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user: User;

    @Column()
    url: string;

    @Column()
    publicId: string; // Cloudinary public_id

    @Column({ default: false })
    isMain: boolean;

    @Column({ default: false })
    isSelfieVerification: boolean;

    @Column({ type: 'int', default: 0 })
    order: number;

    @Column({ type: 'enum', enum: PhotoModerationStatus, default: PhotoModerationStatus.APPROVED })
    moderationStatus: PhotoModerationStatus;

    @Column({ nullable: true })
    moderationNote: string;

    @CreateDateColumn()
    createdAt: Date;
}

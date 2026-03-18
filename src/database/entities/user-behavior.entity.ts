import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    JoinColumn,
    Index,
} from 'typeorm';
import { User } from './user.entity';

@Entity('user_behaviors')
export class UserBehavior {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index({ unique: true })
    @Column({ unique: true })
    userId: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user: User;

    // Aggregated preference signals from swipe history
    @Column({ type: 'simple-array', nullable: true })
    preferredEthnicities: string[];

    @Column({ type: 'simple-array', nullable: true })
    preferredReligiousLevels: string[];

    @Column({ type: 'int', nullable: true })
    preferredAgeMin: number;

    @Column({ type: 'int', nullable: true })
    preferredAgeMax: number;

    @Column({ type: 'simple-array', nullable: true })
    preferredInterests: string[];

    // Engagement metrics
    @Column({ type: 'int', default: 0 })
    totalLikes: number;

    @Column({ type: 'int', default: 0 })
    totalPasses: number;

    @Column({ type: 'int', default: 0 })
    totalSuperLikes: number;

    @Column({ type: 'int', default: 0 })
    totalMatches: number;

    @Column({ type: 'int', default: 0 })
    totalMessagesStarted: number;

    @Column({ type: 'float', default: 0 })
    likeToMatchRatio: number;

    @Column({ type: 'float', default: 0 })
    avgSessionDurationMinutes: number;

    @Column({ type: 'int', default: 0 })
    daysActive: number;

    @Column({ nullable: true })
    lastActiveDate: Date;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

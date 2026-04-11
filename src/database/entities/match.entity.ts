import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    JoinColumn,
    Index,
    Unique,
} from 'typeorm';
import { User } from './user.entity';

export enum MatchStatus {
    ACTIVE = 'active',
    UNMATCHED = 'unmatched',
    CLOSED = 'closed',
}

@Entity('matches')
@Unique(['user1Id', 'user2Id'])
export class Match {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column()
    user1Id: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user1Id' })
    user1: User;

    @Index()
    @Column()
    user2Id: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user2Id' })
    user2: User;

    @Column({ type: 'enum', enum: MatchStatus, default: MatchStatus.ACTIVE })
    status: MatchStatus;

    @CreateDateColumn()
    matchedAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

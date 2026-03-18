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

export enum BoostType {
    FREE = 'free',
    PAID = 'paid',
    REWARD = 'reward',
}

@Entity('boosts')
export class Boost {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column()
    userId: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user: User;

    @Column({ type: 'enum', enum: BoostType, default: BoostType.PAID })
    type: BoostType;

    @Column()
    startedAt: Date;

    @Column()
    expiresAt: Date;

    @Column({ type: 'int', default: 0 })
    profileViewsGained: number;

    @Column({ default: true })
    isActive: boolean;

    @CreateDateColumn()
    createdAt: Date;
}

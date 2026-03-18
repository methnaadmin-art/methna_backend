import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    ManyToOne,
    JoinColumn,
    Index,
    Unique,
} from 'typeorm';
import { User } from './user.entity';

export enum LikeType {
    LIKE = 'like',
    SUPER_LIKE = 'super_like',
    COMPLIMENT = 'compliment',
    PASS = 'pass',
}

@Entity('likes')
@Unique(['likerId', 'likedId'])
@Index(['likerId', 'likedId'])
export class Like {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column()
    likerId: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'likerId' })
    liker: User;

    @Index()
    @Column()
    likedId: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'likedId' })
    liked: User;

    @Column({ type: 'enum', enum: LikeType, default: LikeType.LIKE })
    type: LikeType;

    @Column({ default: true })
    isLike: boolean; // true = like/super_like/compliment, false = pass

    @Column({ nullable: true, length: 500 })
    complimentMessage: string;

    @CreateDateColumn()
    createdAt: Date;
}

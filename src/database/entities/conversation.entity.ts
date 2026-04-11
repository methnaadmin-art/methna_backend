import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    OneToMany,
    JoinColumn,
    Index,
    Unique,
    Relation,
} from 'typeorm';
import { User } from './user.entity';
import { Match } from './match.entity';
import type { Message } from './message.entity';

@Entity('conversations')
@Unique(['user1Id', 'user2Id'])
export class Conversation {
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

    @Index()
    @Column({ nullable: true })
    matchId: string;

    @ManyToOne(() => Match, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'matchId' })
    match: Match;

    @Column({ nullable: true })
    lastMessageContent: string;

    @Column({ nullable: true })
    lastMessageAt: Date;

    @Column({ nullable: true })
    lastMessageSenderId: string;

    @Column({ type: 'int', default: 0 })
    user1UnreadCount: number;

    @Column({ type: 'int', default: 0 })
    user2UnreadCount: number;

    @Column({ default: false })
    user1Muted: boolean;

    @Column({ default: false })
    user2Muted: boolean;

    @Column({ default: true })
    isActive: boolean;

    @Column({ default: false })
    isLocked: boolean;

    @Column({ type: 'varchar', nullable: true })
    lockReason: string | null;

    @Column({ default: false })
    isFlagged: boolean;

    @Column({ type: 'varchar', nullable: true })
    flagReason: string | null;

    @OneToMany('Message', (message: Message) => message.conversation)
    messages: Relation<Message[]>;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

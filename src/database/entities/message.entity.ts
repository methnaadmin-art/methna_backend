import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    ManyToOne,
    JoinColumn,
    Index,
    Relation,
} from 'typeorm';
import { User } from './user.entity';
import { Match } from './match.entity';
import type { Conversation } from './conversation.entity';

export enum MessageType {
    TEXT = 'text',
    IMAGE = 'image',
    SYSTEM = 'system',
}

export enum MessageStatus {
    SENT = 'sent',
    DELIVERED = 'delivered',
    SEEN = 'seen',
}

@Entity('messages')
export class Message {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column()
    conversationId: string;

    @ManyToOne('Conversation', (c: Conversation) => c.messages, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'conversationId' })
    conversation: Relation<Conversation>;

    @Index()
    @Column({ nullable: true })
    matchId: string;

    @ManyToOne(() => Match, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'matchId' })
    match: Match;

    @Index()
    @Column()
    senderId: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'senderId' })
    sender: User;

    @Column({ type: 'text' })
    content: string;

    @Column({ type: 'enum', enum: MessageType, default: MessageType.TEXT })
    type: MessageType;

    @Column({ type: 'enum', enum: MessageStatus, default: MessageStatus.SENT })
    status: MessageStatus;

    @Column({ nullable: true })
    deliveredAt: Date;

    @Column({ nullable: true })
    readAt: Date;

    @CreateDateColumn()
    createdAt: Date;
}

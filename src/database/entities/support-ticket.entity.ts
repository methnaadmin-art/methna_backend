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

export enum TicketStatus {
    OPEN = 'open',
    IN_PROGRESS = 'in_progress',
    RESOLVED = 'resolved',
    CLOSED = 'closed',
}

export enum TicketPriority {
    LOW = 'low',
    MEDIUM = 'medium',
    HIGH = 'high',
    URGENT = 'urgent',
}

@Entity('support_tickets')
export class SupportTicket {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column({ nullable: true })
    userId: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
    @JoinColumn({ name: 'userId' })
    user: User;

    @Column({ nullable: true })
    contactEmail: string;

    @Column()
    subject: string;

    @Column({ type: 'text' })
    message: string;

    @Column({ type: 'enum', enum: TicketStatus, default: TicketStatus.OPEN })
    status: TicketStatus;

    @Column({ type: 'enum', enum: TicketPriority, default: TicketPriority.MEDIUM })
    priority: TicketPriority;

    @Column({ nullable: true })
    assignedToId: string;

    @ManyToOne(() => User, { nullable: true })
    @JoinColumn({ name: 'assignedToId' })
    assignedTo: User;

    @Column({ type: 'text', nullable: true })
    adminReply: string;

    @Column({ nullable: true })
    repliedAt: Date;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

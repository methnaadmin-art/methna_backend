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

export enum LoginResult {
    SUCCESS = 'success',
    FAILED = 'failed',
    BLOCKED = 'blocked',
    SUSPICIOUS = 'suspicious',
}

@Entity('login_history')
export class LoginHistory {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column()
    userId: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user: User;

    @Index()
    @Column()
    ipAddress: string;

    @Column({ nullable: true })
    userAgent: string;

    @Column({ nullable: true })
    deviceFingerprint: string;

    @Column({ nullable: true })
    country: string;

    @Column({ nullable: true })
    city: string;

    @Column({ type: 'enum', enum: LoginResult, default: LoginResult.SUCCESS })
    result: LoginResult;

    @Column({ nullable: true })
    failureReason: string;

    @Column({ default: false })
    isSuspicious: boolean;

    @CreateDateColumn()
    createdAt: Date;
}

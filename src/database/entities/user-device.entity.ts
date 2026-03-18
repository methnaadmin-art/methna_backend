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

@Entity('user_devices')
@Index(['userId', 'deviceFingerprint'], { unique: true })
export class UserDevice {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column()
    userId: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user: User;

    @Column()
    deviceFingerprint: string;

    @Column({ nullable: true })
    deviceName: string;

    @Column({ nullable: true })
    platform: string; // ios, android, web

    @Column({ nullable: true })
    osVersion: string;

    @Column({ nullable: true })
    appVersion: string;

    @Column({ nullable: true })
    ipAddress: string;

    @Column({ default: true })
    isTrusted: boolean;

    @Column({ nullable: true })
    lastActiveAt: Date;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

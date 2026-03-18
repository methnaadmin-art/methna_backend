import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    Index,
} from 'typeorm';

@Entity('email_blacklist')
export class EmailBlacklist {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index({ unique: true })
    @Column({ unique: true })
    domain: string;

    @Column({ nullable: true })
    reason: string;

    @Column({ default: true })
    isActive: boolean;

    @Column({ nullable: true })
    addedBy: string; // admin userId

    @CreateDateColumn()
    createdAt: Date;
}

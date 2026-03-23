import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    Index,
} from 'typeorm';

@Entity('daily_insights')
export class DailyInsight {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ length: 300 })
    content: string;

    @Column({ length: 100, nullable: true })
    author: string; // e.g. "Prophet Muhammad (PBUH)", "Quran 2:187"

    @Column({ length: 50, default: 'general' })
    category: string; // 'marriage', 'patience', 'love', 'faith', 'general'

    @Index()
    @Column({ type: 'date', nullable: true })
    scheduledDate: Date; // if null, randomly rotated

    @Column({ default: true })
    isActive: boolean;

    @Column({ type: 'int', default: 0 })
    displayCount: number;

    @CreateDateColumn()
    createdAt: Date;
}

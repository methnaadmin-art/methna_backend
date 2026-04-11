import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';

export enum AdPlacement {
    BANNER = 'banner',
    INTERSTITIAL = 'interstitial',
    FEED = 'feed',
    POPUP = 'popup',
}

export enum AdStatus {
    ACTIVE = 'active',
    PAUSED = 'paused',
    EXPIRED = 'expired',
    DRAFT = 'draft',
}

@Entity('ads')
export class Ad {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    title: string;

    @Column({ type: 'text', nullable: true })
    description: string;

    @Column({ nullable: true })
    imageUrl: string;

    @Column({ nullable: true })
    buttonText: string;

    @Column({ nullable: true })
    buttonLink: string;

    @Column({ type: 'enum', enum: AdPlacement, default: AdPlacement.BANNER })
    placement: AdPlacement;

    @Column({ type: 'enum', enum: AdStatus, default: AdStatus.DRAFT })
    status: AdStatus;

    @Column({ nullable: true })
    startDate: Date;

    @Column({ nullable: true })
    endDate: Date;

    @Column({ type: 'int', default: 0 })
    impressions: number;

    @Column({ type: 'int', default: 0 })
    clicks: number;

    @Column({ nullable: true })
    targetGender: string;

    @Column({ nullable: true })
    targetPlan: string;

    @Column({ nullable: true })
    targetCountry: string;

    @Column({ nullable: true })
    targetCity: string;

    @Column({ type: 'int', default: 1 })
    showEveryNUsers: number;

    @Column({ type: 'int', default: 1 })
    weight: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    OneToMany,
    Index,
} from 'typeorm';
import { Subscription } from './subscription.entity';

/** Feature entitlements stored as JSONB on each plan. */
export interface PlanEntitlements {
    // Numeric limits (-1 = unlimited)
    dailyLikes?: number;
    dailySuperLikes?: number;
    dailyCompliments?: number;
    monthlyRewinds?: number;
    weeklyBoosts?: number;

    // Boolean feature flags
    unlimitedLikes?: boolean;
    unlimitedRewinds?: boolean;
    advancedFilters?: boolean;
    seeWhoLikesYou?: boolean;
    readReceipts?: boolean;
    typingIndicators?: boolean;
    invisibleMode?: boolean;
    passportMode?: boolean;
    premiumBadge?: boolean;
    hideAds?: boolean;
    rematch?: boolean;
    videoChat?: boolean;
    superLike?: boolean;
    profileBoostPriority?: boolean;
    priorityMatching?: boolean;
    improvedVisits?: boolean;
}

export enum BillingCycle {
    MONTHLY = 'monthly',
    YEARLY = 'yearly',
    WEEKLY = 'weekly',
    ONE_TIME = 'one_time',
}

@Entity('plans')
export class Plan {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index({ unique: true })
    @Column({ unique: true })
    code: string; // Machine-readable: 'free', 'premium', 'gold'

    @Column()
    name: string; // Display name: 'Free', 'Premium', 'Elite'

    @Column({ type: 'text', nullable: true })
    description: string | null;

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    price: number;

    @Column({ default: 'usd' })
    currency: string;

    @Column({ type: 'enum', enum: BillingCycle, default: BillingCycle.MONTHLY })
    billingCycle: BillingCycle;

    @Column({ type: 'varchar', nullable: true })
    stripePriceId: string | null;

    @Column({ default: 30 })
    durationDays: number;

    @Column({ default: true })
    isActive: boolean;

    @Column({ default: true })
    isVisible: boolean; // Whether to show in mobile app

    @Column({ type: 'int', default: 0 })
    sortOrder: number;

    /** All feature entitlements as a single JSONB column.
     *  This is the source of truth for what a plan includes.
     *  Numeric limits use -1 for unlimited. Boolean flags default to false.
     */
    @Column({ type: 'jsonb', default: '{}' })
    entitlements: PlanEntitlements;

    // Legacy feature flags array (kept for backward compat)
    @Column({ type: 'jsonb', default: [] })
    features: string[];

    // Legacy limit columns (kept for backward compat, migrated from entitlements)
    @Column({ type: 'int', default: 10 })
    dailyLikesLimit: number;

    @Column({ type: 'int', default: 0 })
    dailySuperLikesLimit: number;

    @Column({ type: 'int', default: 0 })
    dailyComplimentsLimit: number;

    @Column({ type: 'int', default: 2 })
    monthlyRewindsLimit: number;

    @Column({ type: 'int', default: 0 })
    weeklyBoostsLimit: number;

    @OneToMany(() => Subscription, sub => sub.planEntity)
    subscriptions: Subscription[];

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

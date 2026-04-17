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
    likesLimit?: number;
    boostsLimit?: number;
    complimentsLimit?: number;

    // Boolean feature flags
    unlimitedLikes?: boolean;
    unlimitedRewinds?: boolean;
    advancedFilters?: boolean;
    seeWhoLikesYou?: boolean;
    readReceipts?: boolean;
    typingIndicators?: boolean;
    invisibleMode?: boolean;
    ghostMode?: boolean;
    passportMode?: boolean;
    whoLikedMe?: boolean;
    boost?: boolean;
    likes?: boolean;
    premiumBadge?: boolean;
    hideAds?: boolean;
    rematch?: boolean;
    videoChat?: boolean;
    superLike?: boolean;
    profileBoostPriority?: boolean;
    priorityMatching?: boolean;
    improvedVisits?: boolean;
}

/** Boolean feature contract exposed to clients/admin for plan authoring. */
export interface PlanFeatureFlags {
    unlimitedLikes?: boolean;
    unlimitedRewinds?: boolean;
    advancedFilters?: boolean;
    seeWhoLikesYou?: boolean;
    readReceipts?: boolean;
    typingIndicators?: boolean;
    invisibleMode?: boolean;
    ghostMode?: boolean;
    passportMode?: boolean;
    whoLikedMe?: boolean;
    boost?: boolean;
    likes?: boolean;
    premiumBadge?: boolean;
    hideAds?: boolean;
    rematch?: boolean;
    videoChat?: boolean;
    superLike?: boolean;
    profileBoostPriority?: boolean;
    priorityMatching?: boolean;
    improvedVisits?: boolean;
}

/** Numeric limits contract exposed to clients/admin for plan authoring. */
export interface PlanLimits {
    dailyLikes?: number;
    dailySuperLikes?: number;
    dailyCompliments?: number;
    monthlyRewinds?: number;
    weeklyBoosts?: number;
    likesLimit?: number;
    boostsLimit?: number;
    complimentsLimit?: number;
}

export enum BillingCycle {
    MONTHLY = 'monthly',
    YEARLY = 'yearly',
    WEEKLY = 'weekly',
    ONE_TIME = 'one_time',
}

@Index('UQ_plans_googleProductId_googleBasePlanId', ['googleProductId', 'googleBasePlanId'], {
    unique: true,
    where: '"googleProductId" IS NOT NULL AND "googleBasePlanId" IS NOT NULL',
})
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

    /** Stripe product ID (e.g. 'prod_xxx'). Used to map Stripe subscriptions to internal plans. */
    @Index()
    @Column({ type: 'varchar', nullable: true })
    stripeProductId: string | null;

    /** Google Play Billing product ID (e.g. 'com.methna.app.premium_monthly').
     *  Used to map Android in-app purchases to internal plans. */
    @Index()
    @Column({ type: 'varchar', nullable: true })
    googleProductId: string | null;

    /** Google Play base plan ID (e.g. 'monthly001') for subscription offers mapping. */
    @Index()
    @Column({ type: 'varchar', nullable: true })
    googleBasePlanId: string | null;

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

    /** Structured client-facing feature contract derived from entitlements. */
    @Column({ type: 'jsonb', default: '{}' })
    featureFlags: PlanFeatureFlags;

    /** Structured client-facing limits contract derived from entitlements. */
    @Column({ type: 'jsonb', default: '{}' })
    limits: PlanLimits;

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

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
import { Plan, BillingCycle } from './plan.entity';

/** @deprecated Use Plan.code from planEntity instead. Kept for DB backward compat. */
export enum SubscriptionPlan {
    FREE = 'free',
    PREMIUM = 'premium',
    GOLD = 'gold',
}

/** @deprecated Use Plan.code instead. */
export const ELITE_PLAN = SubscriptionPlan.GOLD;

export enum SubscriptionStatus {
    ACTIVE = 'active',
    CANCELLED = 'cancelled',
    EXPIRED = 'expired',
    PAST_DUE = 'past_due',
    TRIAL = 'trial',
}

@Entity('subscriptions')
export class Subscription {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column()
    userId: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user: User;

    @ManyToOne(() => Plan, plan => plan.subscriptions, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'planId' })
    planEntity: Plan | null;

    @Column({ nullable: true })
    planId: string | null;

    /** @deprecated Legacy enum column — use planEntity.code for dynamic plans. */
    @Column({ type: 'enum', enum: SubscriptionPlan, default: SubscriptionPlan.FREE })
    plan: SubscriptionPlan;

    @Column({ type: 'enum', enum: SubscriptionStatus, default: SubscriptionStatus.ACTIVE })
    status: SubscriptionStatus;

    @Column({ type: 'timestamp', nullable: true })
    startDate: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    endDate: Date | null;

    @Column({ nullable: true })
    paymentReference: string | null;

    @Column({ nullable: true })
    stripeSubscriptionId: string | null;

    @Column({ nullable: true })
    stripeCheckoutSessionId: string | null;

    @Column({ nullable: true })
    stripeCustomerId: string | null;

    @Column({ type: 'enum', enum: BillingCycle, nullable: true })
    billingCycle: BillingCycle | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

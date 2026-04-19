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
import { Plan } from './plan.entity';
import { BillingCycle } from './billing-cycle.enum';

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
    PENDING_CANCELLATION = 'pending_cancellation',
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

    @Column({ type: 'varchar', nullable: true })
    planId: string | null;

    /** @deprecated Legacy enum column — use planEntity.code for dynamic plans. */
    @Column({ type: 'varchar', default: SubscriptionPlan.FREE })
    plan: string;

    @Column({ type: 'enum', enum: SubscriptionStatus, default: SubscriptionStatus.ACTIVE })
    status: SubscriptionStatus;

    @Column({ type: 'timestamp', nullable: true })
    startDate: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    endDate: Date | null;

    @Column({ type: 'varchar', nullable: true })
    paymentReference: string | null;

    @Column({ type: 'varchar', nullable: true })
    paymentProvider: string | null;

    @Column({ type: 'varchar', nullable: true })
    googleProductId: string | null;

    @Index()
    @Column({ type: 'varchar', nullable: true })
    googlePurchaseToken: string | null;

    @Column({ type: 'varchar', nullable: true })
    googleOrderId: string | null;

    @Column({ type: 'varchar', nullable: true })
    stripeSubscriptionId: string | null;

    @Column({ type: 'varchar', nullable: true })
    stripeCheckoutSessionId: string | null;

    @Column({ type: 'varchar', nullable: true })
    stripeCustomerId: string | null;

    @Column({ type: 'enum', enum: BillingCycle, nullable: true })
    billingCycle: BillingCycle | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

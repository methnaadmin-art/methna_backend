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

export enum PurchaseProvider {
    STRIPE = 'stripe',
    GOOGLE_PLAY = 'google_play',
    APPLE = 'apple',
}

export enum PurchaseStatus {
    PENDING = 'pending',
    VERIFIED = 'verified',
    FAILED = 'failed',
    REFUNDED = 'refunded',
    CANCELLED = 'cancelled',
}

@Entity('purchase_transactions')
export class PurchaseTransaction {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column()
    userId: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user: User;

    @Index()
    @Column({ type: 'uuid', nullable: true })
    planId: string | null;

    @ManyToOne(() => Plan, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'planId' })
    plan: Plan | null;

    @Column({ type: 'enum', enum: PurchaseProvider })
    provider: PurchaseProvider;

    /** Google Play: purchaseToken. Stripe: checkout session ID. */
    @Index({ unique: true })
    @Column({ type: 'varchar', nullable: true })
    purchaseToken: string | null;

    /** Google Play: productId (e.g. com.methna.app.premium_monthly). */
    @Column({ type: 'varchar', nullable: true })
    productId: string | null;

    /** Google Play: orderId (e.g. GPA.1234...). */
    @Column({ type: 'varchar', nullable: true })
    orderId: string | null;

    @Column({ type: 'enum', enum: PurchaseStatus, default: PurchaseStatus.PENDING })
    status: PurchaseStatus;

    /** Raw verification response from Google Play Developer API. */
    @Column({ type: 'jsonb', default: '{}' })
    rawVerification: Record<string, any>;

    @Column({ type: 'timestamp', nullable: true })
    transactionDate: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    expiryDate: Date | null;

    @Column({ type: 'varchar', nullable: true })
    paymentReference: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

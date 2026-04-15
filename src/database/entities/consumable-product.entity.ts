import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from 'typeorm';

export enum ConsumableType {
    LIKES_PACK = 'likes_pack',
    COMPLIMENTS_PACK = 'compliments_pack',
    BOOSTS_PACK = 'boosts_pack',
}

export enum PlatformAvailability {
    ALL = 'all',
    MOBILE = 'mobile',
    WEB = 'web',
}

@Entity('consumable_products')
export class ConsumableProduct {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index({ unique: true })
    @Column({ unique: true })
    code: string; // Machine-readable: 'likes_10', 'compliments_25', 'boosts_5'

    @Column()
    title: string; // Display: '10 Likes'

    @Column({ type: 'text', nullable: true })
    description: string | null;

    @Column({ type: 'enum', enum: ConsumableType })
    type: ConsumableType;

    @Column({ type: 'int' })
    quantity: number; // How many likes/compliments/boosts this pack grants

    @Column({ type: 'decimal', precision: 10, scale: 2 })
    price: number;

    @Column({ default: 'usd' })
    currency: string;

    @Column({ default: true })
    isActive: boolean;

    @Column({ default: false })
    isArchived: boolean; // Archived products can't be bought but purchase history remains intact

    @Column({ type: 'enum', enum: PlatformAvailability, default: PlatformAvailability.ALL })
    platformAvailability: PlatformAvailability;

    @Column({ type: 'int', default: 0 })
    sortOrder: number;

    /** Google Play product ID (e.g. 'com.methnapp.app.likes_10') */
    @Index()
    @Column({ type: 'varchar', nullable: true })
    googleProductId: string | null;

    /** Stripe Price ID (e.g. 'price_abc123') for one-time payment */
    @Index()
    @Column({ type: 'varchar', nullable: true })
    stripePriceId: string | null;

    /** Stripe Product ID (e.g. 'prod_xyz') */
    @Index()
    @Column({ type: 'varchar', nullable: true })
    stripeProductId: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

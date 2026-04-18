import {
    Injectable,
    Logger,
    BadRequestException,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
    Repository,
    DataSource,
    MoreThan,
    In,
} from 'typeorm';
import {
    ConsumableProduct,
    ConsumableType,
    PlatformAvailability,
} from '../../database/entities/consumable-product.entity';
import {
    PurchaseTransaction,
    PurchaseProvider,
    PurchaseStatus,
} from '../../database/entities/purchase-transaction.entity';
import { User } from '../../database/entities/user.entity';
import { Boost, BoostType } from '../../database/entities/boost.entity';
import { RedisService } from '../redis/redis.service';

// ─── DTOs ──────────────────────────────────────────────────

export interface CreateConsumableProductDto {
    code: string;
    title: string;
    description?: string;
    type: ConsumableType;
    quantity: number;
    price: number;
    currency?: string;
    platformAvailability?: PlatformAvailability;
    sortOrder?: number;
    googleProductId?: string;
    stripePriceId?: string;
    stripeProductId?: string;
}

export interface UpdateConsumableProductDto {
    title?: string;
    description?: string;
    quantity?: number;
    price?: number;
    currency?: string;
    platformAvailability?: PlatformAvailability;
    sortOrder?: number;
    googleProductId?: string;
    stripePriceId?: string;
    stripeProductId?: string;
    isActive?: boolean;
    isArchived?: boolean;
}

export interface VerifyConsumablePurchaseDto {
    productId: string; // Google Play product ID or Stripe price ID
    purchaseToken: string;
    platform: 'android' | 'web';
    provider: 'google_play' | 'stripe';
    orderId?: string;
    transactionDate?: string;
}

export interface ConsumeBalanceDto {
    type: 'likes' | 'compliments' | 'boosts';
    quantity?: number; // defaults to 1
    durationMinutes?: number; // for boosts
}

@Injectable()
export class ConsumableService {
    private readonly logger = new Logger(ConsumableService.name);
    private static readonly MAX_DAILY_PURCHASES = 10;

    constructor(
        @InjectRepository(ConsumableProduct)
        private readonly productRepo: Repository<ConsumableProduct>,
        @InjectRepository(PurchaseTransaction)
        private readonly purchaseRepo: Repository<PurchaseTransaction>,
        @InjectRepository(User)
        private readonly userRepo: Repository<User>,
        @InjectRepository(Boost)
        private readonly boostRepo: Repository<Boost>,
        private readonly redisService: RedisService,
        private readonly dataSource: DataSource,
    ) {}

    // ─── PRODUCT CATALOG (public) ──────────────────────────

    /** Get active consumable products for a specific platform */
    async getProducts(platform: 'mobile' | 'web'): Promise<ConsumableProduct[]> {
        const platformFilter = platform === 'mobile'
            ? [PlatformAvailability.ALL, PlatformAvailability.MOBILE]
            : [PlatformAvailability.ALL, PlatformAvailability.WEB];

        return this.productRepo.find({
            where: {
                isActive: true,
                isArchived: false,
                platformAvailability: In(platformFilter),
            },
            order: { sortOrder: 'ASC', price: 'ASC' },
        });
    }

    /** Get all consumable products (admin) */
    async getAllProducts(filters?: {
        type?: ConsumableType;
        active?: boolean;
        archived?: boolean;
        search?: string;
    }): Promise<{ items: ConsumableProduct[]; total: number }> {
        const qb = this.productRepo.createQueryBuilder('p');

        if (filters?.type) qb.andWhere('p.type = :type', { type: filters.type });
        if (filters?.active !== undefined) qb.andWhere('p.isActive = :active', { active: filters.active });
        if (filters?.archived !== undefined) qb.andWhere('p.isArchived = :archived', { archived: filters.archived });
        if (filters?.search) {
            const s = `%${filters.search.trim()}%`;
            qb.andWhere('(p.code ILIKE :s OR p.title ILIKE :s OR p.description ILIKE :s)', { s });
        }

        qb.orderBy('p.sortOrder', 'ASC').addOrderBy('p.price', 'ASC');

        const [items, total] = await qb.getManyAndCount();
        return { items, total };
    }

    // ─── PRODUCT CRUD (admin) ──────────────────────────────

    async createProduct(dto: CreateConsumableProductDto): Promise<ConsumableProduct> {
        this.validateProductDto(dto);

        const existing = await this.productRepo.findOne({ where: { code: dto.code } });
        if (existing) throw new BadRequestException(`Product code '${dto.code}' already exists`);

        const product = this.productRepo.create({
            code: dto.code,
            title: dto.title,
            description: dto.description || null,
            type: dto.type,
            quantity: dto.quantity,
            price: dto.price,
            currency: dto.currency || 'usd',
            platformAvailability: dto.platformAvailability || PlatformAvailability.ALL,
            sortOrder: dto.sortOrder || 0,
            googleProductId: dto.googleProductId || null,
            stripePriceId: dto.stripePriceId || null,
            stripeProductId: dto.stripeProductId || null,
            isActive: true,
            isArchived: false,
        });

        return this.productRepo.save(product);
    }

    async updateProduct(id: string, dto: UpdateConsumableProductDto): Promise<ConsumableProduct> {
        const product = await this.productRepo.findOne({ where: { id } });
        if (!product) throw new NotFoundException('Product not found');

        if (dto.title !== undefined) product.title = dto.title;
        if (dto.description !== undefined) product.description = dto.description;
        if (dto.quantity !== undefined) product.quantity = dto.quantity;
        if (dto.price !== undefined) product.price = dto.price;
        if (dto.currency !== undefined) product.currency = dto.currency;
        if (dto.platformAvailability !== undefined) product.platformAvailability = dto.platformAvailability;
        if (dto.sortOrder !== undefined) product.sortOrder = dto.sortOrder;
        if (dto.googleProductId !== undefined) product.googleProductId = dto.googleProductId;
        if (dto.stripePriceId !== undefined) product.stripePriceId = dto.stripePriceId;
        if (dto.stripeProductId !== undefined) product.stripeProductId = dto.stripeProductId;
        if (dto.isActive !== undefined) product.isActive = dto.isActive;
        if (dto.isArchived !== undefined) product.isArchived = dto.isArchived;

        return this.productRepo.save(product);
    }

    async archiveProduct(id: string): Promise<ConsumableProduct> {
        const product = await this.productRepo.findOne({ where: { id } });
        if (!product) throw new NotFoundException('Product not found');

        product.isActive = false;
        product.isArchived = true;
        return this.productRepo.save(product);
    }

    // ─── GRANT BALANCE (after payment verification) ─────────

    /** Grant consumable balance to user after verified purchase. Idempotent by purchaseToken. */
    async grantBalance(
        userId: string,
        productId: string, // ConsumableProduct.id
        provider: PurchaseProvider,
        purchaseToken: string,
        orderId?: string,
        rawVerification?: Record<string, any>,
        transactionDate?: Date,
    ): Promise<{ granted: boolean; balances: UserBalances }> {
        const product = await this.productRepo.findOne({ where: { id: productId } });
        if (!product) throw new NotFoundException('Consumable product not found');
        if (!product.isActive || product.isArchived) {
            throw new BadRequestException('Product is not available for purchase');
        }

        // Idempotency: check if purchaseToken already processed
        const existing = await this.purchaseRepo.findOne({ where: { purchaseToken } });
        if (existing?.status === PurchaseStatus.VERIFIED) {
            // Already granted — return current balances
            const user = await this.getUserWithBalances(userId);
            return { granted: false, balances: this.extractBalances(user) };
        }

        return this.dataSource.transaction(async (manager) => {
            const purchaseRepo = manager.getRepository(PurchaseTransaction);
            const userRepo = manager.getRepository(User);

            const { startOfDay, endOfDay } = this.getUtcDayWindow(new Date());
            const purchasesToday = await purchaseRepo
                .createQueryBuilder('purchase')
                .where('purchase.userId = :userId', { userId })
                .andWhere('purchase.status = :status', { status: PurchaseStatus.VERIFIED })
                .andWhere('purchase.consumableProductId IS NOT NULL')
                .andWhere('purchase.transactionDate >= :startOfDay', { startOfDay })
                .andWhere('purchase.transactionDate < :endOfDay', { endOfDay })
                .getCount();

            const reachedDailyLimit = purchasesToday >= ConsumableService.MAX_DAILY_PURCHASES;
            if (reachedDailyLimit) {
                throw new BadRequestException(
                    `Daily consumable purchase limit reached (${ConsumableService.MAX_DAILY_PURCHASES}/day).`,
                );
            }

            // Create/update purchase record
            const purchase = existing || purchaseRepo.create({
                userId,
                consumableProductId: product.id,
                provider,
                purchaseToken,
                productId: this.getProviderProductId(product, provider),
                orderId: orderId || null,
                status: PurchaseStatus.PENDING,
                rawVerification: rawVerification || {},
                transactionDate: transactionDate || new Date(),
                expiryDate: null,
                paymentReference: null,
            });

            const effectiveTransactionDate = purchase.transactionDate || new Date();
            if (effectiveTransactionDate < startOfDay || effectiveTransactionDate >= endOfDay) {
                purchase.transactionDate = new Date();
            }

            purchase.status = PurchaseStatus.VERIFIED;
            purchase.rawVerification = {
                ...(purchase.rawVerification || {}),
                grantedAt: new Date().toISOString(),
                productType: product.type,
                quantity: product.quantity,
            };

            const savedPurchase = await purchaseRepo.save(purchase);

            // Increment the correct balance
            const balanceField = this.getBalanceField(product.type);
            await userRepo.increment({ id: userId }, balanceField, product.quantity);

            this.logger.log(
                `Granted ${product.quantity} ${product.type} to user ${userId} (purchase: ${savedPurchase.id})`,
            );

            // Invalidate balance cache
            await this.redisService.del(`balances:${userId}`);

            const user = await userRepo.findOne({ where: { id: userId }, select: ['id', 'likesBalance', 'complimentsBalance', 'boostsBalance'] });
            return { granted: true, balances: this.extractBalances(user!) };
        });
    }

    private getUtcDayWindow(date: Date): { startOfDay: Date; endOfDay: Date } {
        const startOfDay = new Date(
            Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
        );
        const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
        return { startOfDay, endOfDay };
    }

    // ─── CONSUME BALANCE (used by like/compliment/boost actions) ─

    /** Consume from consumable balance. Returns remaining balance after consumption. */
    async consumeBalance(userId: string, type: 'likes' | 'compliments' | 'boosts', quantity: number = 1): Promise<{ success: boolean; remaining: number }> {
        const balanceField = type === 'likes' ? 'likesBalance' : type === 'compliments' ? 'complimentsBalance' : 'boostsBalance';
        const cacheKey = `balances:${userId}`;
        const cachedBalances = await this.redisService.getJson<UserBalances>(cacheKey).catch(() => null);
        const cachedCurrentBalance = cachedBalances?.[type];
        if (typeof cachedCurrentBalance === 'number' && cachedCurrentBalance < quantity) {
            return { success: false, remaining: cachedCurrentBalance };
        }

        const user = await this.userRepo.findOne({
            where: { id: userId },
            select: ['id', 'likesBalance', 'complimentsBalance', 'boostsBalance'],
        });
        if (!user) throw new NotFoundException('User not found');

        const currentBalance = user[balanceField];
        if (currentBalance < quantity) {
            await this.redisService.setJson(cacheKey, this.extractBalances(user), 300);
            return { success: false, remaining: currentBalance };
        }

        await this.userRepo.decrement({ id: userId, [balanceField]: MoreThan(quantity - 1) }, balanceField, quantity);

        const updated = await this.userRepo.findOne({
            where: { id: userId },
            select: ['id', 'likesBalance', 'complimentsBalance', 'boostsBalance'],
        });

        if (updated) {
            await this.redisService.setJson(cacheKey, this.extractBalances(updated), 300);
        } else {
            await this.redisService.del(cacheKey);
        }

        this.logger.log(`Consumed ${quantity} ${type} from user ${userId} (was ${currentBalance}, now ${updated?.[balanceField] ?? 0})`);
        return { success: true, remaining: updated?.[balanceField] ?? 0 };
    }

    /** Activate a boost from consumable balance. Decrements boostsBalance and creates Boost record. */
    async activateBoost(userId: string, durationMinutes: number = 30): Promise<{ success: boolean; remaining: number; boost: Boost | null }> {
        const consumeResult = await this.consumeBalance(userId, 'boosts', 1);
        if (!consumeResult.success) {
            return { success: false, remaining: consumeResult.remaining, boost: null };
        }

        // Check for existing active boost
        const activeBoost = await this.boostRepo.findOne({
            where: { userId, isActive: true, expiresAt: MoreThan(new Date()) },
        });

        const now = new Date();
        const baseDate = activeBoost?.expiresAt || now;
        const expiresAt = new Date(baseDate.getTime() + durationMinutes * 60 * 1000);

        const boost = this.boostRepo.create({
            userId,
            type: BoostType.PAID,
            startedAt: now,
            expiresAt,
            isActive: true,
        });

        const savedBoost = await this.boostRepo.save(boost);
        await this.userRepo.update(userId, { boostedUntil: expiresAt });
        await this.redisService.set(`boost:${userId}`, '1', Math.ceil(durationMinutes * 60));

        this.logger.log(`User ${userId} activated a ${durationMinutes}-minute boost from consumable balance`);
        return { success: true, remaining: consumeResult.remaining, boost: savedBoost };
    }

    // ─── USER BALANCES ──────────────────────────────────────

    async getUserBalances(userId: string): Promise<UserBalances> {
        const cacheKey = `balances:${userId}`;
        const cached = await this.redisService.getJson<UserBalances>(cacheKey);
        if (cached) return cached;

        const user = await this.getUserWithBalances(userId);
        const balances = this.extractBalances(user);
        await this.redisService.setJson(cacheKey, balances, 300);
        return balances;
    }

    /** Admin: manually adjust user balance with audit trail */
    async adjustBalance(
        userId: string,
        type: 'likes' | 'compliments' | 'boosts',
        delta: number,
        adminId: string,
        reason: string,
    ): Promise<UserBalances> {
        const user = await this.getUserWithBalances(userId);
        if (!user) throw new NotFoundException('User not found');

        const balanceField = type === 'likes' ? 'likesBalance' : type === 'compliments' ? 'complimentsBalance' : 'boostsBalance';
        const newBalance = Math.max(0, user[balanceField] + delta);

        await this.userRepo.update(userId, { [balanceField]: newBalance });
        await this.redisService.del(`balances:${userId}`);

        // Record admin adjustment as a purchase transaction for audit
        const audit = this.purchaseRepo.create({
            userId,
            consumableProductId: null,
            provider: PurchaseProvider.GOOGLE_PLAY, // placeholder
            purchaseToken: `admin_adjust_${Date.now()}_${adminId}`,
            productId: `admin_adjust_${type}`,
            orderId: null,
            status: PurchaseStatus.VERIFIED,
            rawVerification: {
                type: 'admin_balance_adjustment',
                adminId,
                reason,
                balanceType: type,
                delta,
                previousBalance: user[balanceField],
                newBalance,
            },
            transactionDate: new Date(),
            expiryDate: null,
            paymentReference: null,
        });
        await this.purchaseRepo.save(audit);

        this.logger.log(`Admin ${adminId} adjusted ${type} balance for user ${userId}: ${user[balanceField]} → ${newBalance} (reason: ${reason})`);

        const updated = await this.getUserWithBalances(userId);
        return this.extractBalances(updated);
    }

    // ─── PURCHASE HISTORY ───────────────────────────────────

    async getPurchaseHistory(userId: string, page: number = 1, limit: number = 20): Promise<{ items: any[]; total: number }> {
        const qb = this.purchaseRepo.createQueryBuilder('p')
            .leftJoinAndSelect('p.consumableProduct', 'product')
            .where('p.userId = :userId', { userId })
            .andWhere('p.consumableProductId IS NOT NULL')
            .orderBy('p.createdAt', 'DESC')
            .skip((page - 1) * limit)
            .take(limit);

        const [rows, count] = await qb.getManyAndCount();

        return {
            items: rows.map(row => ({
                id: row.id,
                product: row.consumableProduct ? {
                    id: row.consumableProduct.id,
                    code: row.consumableProduct.code,
                    title: row.consumableProduct.title,
                    type: row.consumableProduct.type,
                    quantity: row.consumableProduct.quantity,
                } : null,
                provider: row.provider,
                status: row.status,
                orderId: row.orderId,
                transactionDate: row.transactionDate,
                createdAt: row.createdAt,
            })),
            total: count,
        };
    }

    // ─── RESOLVE PRODUCT BY PROVIDER ID ─────────────────────

    /** Find a consumable product by Google Play product ID */
    async findByGoogleProductId(googleProductId: string): Promise<ConsumableProduct | null> {
        return this.productRepo.findOne({
            where: { googleProductId, isActive: true, isArchived: false },
        });
    }

    /** Find a consumable product by Stripe price ID */
    async findByStripePriceId(stripePriceId: string): Promise<ConsumableProduct | null> {
        return this.productRepo.findOne({
            where: { stripePriceId, isActive: true, isArchived: false },
        });
    }

    // ─── HELPERS ─────────────────────────────────────────────

    private validateProductDto(dto: CreateConsumableProductDto): void {
        if (!dto.code?.trim()) throw new BadRequestException('Product code is required');
        if (!dto.title?.trim()) throw new BadRequestException('Product title is required');
        if (!dto.type) throw new BadRequestException('Product type is required');
        if (!Object.values(ConsumableType).includes(dto.type)) {
            throw new BadRequestException(`Invalid product type. Must be one of: ${Object.values(ConsumableType).join(', ')}`);
        }
        if (dto.quantity < 1) throw new BadRequestException('Quantity must be at least 1');
        if (dto.price <= 0) throw new BadRequestException('Price must be greater than 0');
        if (!/^[a-z0-9_]+$/.test(dto.code)) {
            throw new BadRequestException('Product code must be lowercase alphanumeric with underscores only');
        }
    }

    private getBalanceField(type: ConsumableType): string {
        switch (type) {
            case ConsumableType.LIKES_PACK: return 'likesBalance';
            case ConsumableType.COMPLIMENTS_PACK: return 'complimentsBalance';
            case ConsumableType.BOOSTS_PACK: return 'boostsBalance';
            default: throw new BadRequestException(`Unknown consumable type: ${type}`);
        }
    }

    private getProviderProductId(product: ConsumableProduct, provider: PurchaseProvider): string {
        switch (provider) {
            case PurchaseProvider.GOOGLE_PLAY: return product.googleProductId || product.code;
            case PurchaseProvider.STRIPE: return product.stripePriceId || product.code;
            default: return product.code;
        }
    }

    private async getUserWithBalances(userId: string): Promise<User> {
        const user = await this.userRepo.findOne({
            where: { id: userId },
            select: ['id', 'likesBalance', 'complimentsBalance', 'boostsBalance'],
        });
        if (!user) throw new NotFoundException('User not found');
        return user;
    }

    private extractBalances(user: User): UserBalances {
        return {
            likes: user.likesBalance ?? 0,
            compliments: user.complimentsBalance ?? 0,
            boosts: user.boostsBalance ?? 0,
        };
    }
}

export interface UserBalances {
    likes: number;
    compliments: number;
    boosts: number;
}

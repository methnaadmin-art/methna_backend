import {
    BadRequestException,
    Injectable,
    Logger,
    ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Plan } from '../../database/entities/plan.entity';
import {
    PurchaseProvider,
    PurchaseStatus,
    PurchaseTransaction,
} from '../../database/entities/purchase-transaction.entity';
import {
    Subscription,
    SubscriptionStatus,
} from '../../database/entities/subscription.entity';
import { ConsumableProduct } from '../../database/entities/consumable-product.entity';
import { User } from '../../database/entities/user.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ConsumableService } from '../consumables/consumable.service';

export interface VerifyApplePurchaseDto {
    platform?: string;
    provider?: string;
    productId: string;
    receiptData: string;
    transactionId?: string;
    originalTransactionId?: string;
    transactionDate?: string;
    restored?: boolean;
}

interface AppleReceiptVerification {
    raw: Record<string, any>;
    transaction: Record<string, any>;
    transactionId: string;
    originalTransactionId: string | null;
    expiryDate: Date | null;
    transactionDate: Date;
}

@Injectable()
export class AppleBillingService {
    private readonly logger = new Logger(AppleBillingService.name);

    constructor(
        private readonly configService: ConfigService,
        @InjectRepository(PurchaseTransaction)
        private readonly purchaseRepo: Repository<PurchaseTransaction>,
        @InjectRepository(Plan)
        private readonly planRepo: Repository<Plan>,
        @InjectRepository(Subscription)
        private readonly subscriptionRepo: Repository<Subscription>,
        @InjectRepository(User)
        private readonly userRepo: Repository<User>,
        @InjectRepository(ConsumableProduct)
        private readonly consumableProductRepo: Repository<ConsumableProduct>,
        private readonly subscriptionsService: SubscriptionsService,
        private readonly consumableService: ConsumableService,
        private readonly dataSource: DataSource,
    ) {}

    async verifyAndActivatePurchase(userId: string, dto: VerifyApplePurchaseDto) {
        const productId = String(dto.productId || '').trim();
        const receiptData = String(dto.receiptData || '').trim();
        const provider = String(dto.provider || 'apple').trim().toLowerCase();
        const platform = String(dto.platform || 'ios').trim().toLowerCase();

        if (!productId || !receiptData) {
            throw new BadRequestException('productId and receiptData are required');
        }
        if (provider !== 'apple') {
            throw new BadRequestException('Only apple provider is supported.');
        }
        if (platform !== 'ios' && platform !== 'macos') {
            throw new BadRequestException('Apple verification is only valid for iOS/macOS platform.');
        }

        await this.ensureUserExists(userId);

        const consumableProduct = await this.consumableProductRepo.findOne({
            where: { iosProductId: productId, isActive: true, isArchived: false },
        });

        if (consumableProduct) {
            return this.verifyAndActivateConsumablePurchase(userId, dto);
        }

        const plan = await this.resolveApplePlan(productId);
        const verification = await this.verifyReceipt(dto, productId);
        const purchaseToken = verification.transactionId;

        const existingPurchase = await this.purchaseRepo.findOne({ where: { purchaseToken } });
        if (existingPurchase?.status === PurchaseStatus.VERIFIED) {
            const existingSubscription = await this.subscriptionRepo.findOne({
                where: [
                    { id: existingPurchase.paymentReference || undefined },
                    { userId, appleTransactionId: verification.transactionId },
                ],
                relations: ['planEntity'],
                order: { updatedAt: 'DESC' },
            });

            if (existingSubscription && this.isSubscriptionStillActive(existingSubscription)) {
                await this.subscriptionsService.syncUserPremiumState(userId);
                return {
                    status: 'already_verified',
                    provider: 'apple',
                    platform,
                    plan: this.serializePlan(plan),
                    subscription: this.serializeSubscription(existingSubscription),
                    entitlements: this.buildEntitlementSnapshot(plan),
                };
            }
        }

        const expiryDate = this.resolveExpiryDate(plan, verification.expiryDate, verification.transactionDate);

        const subscription = await this.dataSource.transaction(async (manager) => {
            const purchaseRepository = manager.getRepository(PurchaseTransaction);
            const subscriptionRepository = manager.getRepository(Subscription);

            const purchase = existingPurchase || purchaseRepository.create({
                userId,
                planId: plan.id,
                provider: PurchaseProvider.APPLE,
                platform,
                purchaseToken,
                productId,
                orderId: verification.transactionId,
                status: PurchaseStatus.PENDING,
                rawVerification: {},
                transactionDate: verification.transactionDate,
                expiryDate,
                paymentReference: null,
            });

            purchase.userId = userId;
            purchase.planId = plan.id;
            purchase.provider = PurchaseProvider.APPLE;
            purchase.platform = platform;
            purchase.purchaseToken = purchaseToken;
            purchase.productId = productId;
            purchase.orderId = verification.transactionId;
            purchase.status = PurchaseStatus.VERIFIED;
            purchase.rawVerification = {
                ...(purchase.rawVerification || {}),
                verifiedAt: new Date().toISOString(),
                restored: !!dto.restored,
                apple: {
                    transaction: verification.transaction,
                    receiptStatus: verification.raw.status,
                },
            };
            purchase.transactionDate = verification.transactionDate;
            purchase.expiryDate = expiryDate;

            const savedPurchase = await purchaseRepository.save(purchase);

            await subscriptionRepository.update(
                { userId, status: SubscriptionStatus.ACTIVE },
                { status: SubscriptionStatus.CANCELLED },
            );
            await subscriptionRepository.update(
                { userId, status: SubscriptionStatus.PENDING_CANCELLATION },
                { status: SubscriptionStatus.CANCELLED },
            );
            await subscriptionRepository.update(
                { userId, status: SubscriptionStatus.PAST_DUE },
                { status: SubscriptionStatus.CANCELLED },
            );
            await subscriptionRepository.update(
                { userId, status: SubscriptionStatus.TRIAL },
                { status: SubscriptionStatus.CANCELLED },
            );

            const createdSubscription = subscriptionRepository.create({
                userId,
                plan: plan.code,
                planId: plan.id,
                planEntity: plan,
                status: SubscriptionStatus.ACTIVE,
                startDate: verification.transactionDate,
                endDate: expiryDate,
                paymentReference: savedPurchase.id,
                paymentProvider: PurchaseProvider.APPLE,
                googleProductId: null,
                googlePurchaseToken: null,
                googleOrderId: null,
                appleProductId: productId,
                appleTransactionId: verification.transactionId,
                appleOriginalTransactionId: verification.originalTransactionId,
                stripeSubscriptionId: null,
                stripeCheckoutSessionId: null,
                stripeCustomerId: null,
                billingCycle: plan.billingCycle,
            });

            const savedSubscription = await subscriptionRepository.save(createdSubscription);
            savedPurchase.paymentReference = savedSubscription.id;
            await purchaseRepository.save(savedPurchase);

            return savedSubscription;
        });

        await this.subscriptionsService.syncUserPremiumState(userId);

        this.logger.log(
            `[APPLE_PAYMENT] Premium activated user=${userId} productId=${productId} subscriptionId=${subscription.id} until=${subscription.endDate?.toISOString() || 'n/a'}`,
        );

        return {
            status: 'verified',
            provider: 'apple',
            platform,
            restored: !!dto.restored,
            plan: this.serializePlan(plan),
            subscription: this.serializeSubscription(subscription),
            entitlements: this.buildEntitlementSnapshot(plan),
        };
    }

    async restorePurchase(userId: string, dto: VerifyApplePurchaseDto) {
        return this.verifyAndActivatePurchase(userId, {
            ...dto,
            provider: 'apple',
            platform: dto.platform || 'ios',
            restored: true,
        });
    }

    async verifyAndActivateConsumablePurchase(userId: string, dto: VerifyApplePurchaseDto) {
        const productId = String(dto.productId || '').trim();
        const product = await this.consumableProductRepo.findOne({
            where: { iosProductId: productId, isActive: true, isArchived: false },
        });
        if (!product) {
            throw new BadRequestException(`No active consumable product mapped to App Store ID '${productId}'`);
        }

        const verification = await this.verifyReceipt(dto, productId);
        const balances = await this.consumableService.grantBalance(
            userId,
            product.id,
            PurchaseProvider.APPLE,
            verification.transactionId,
            verification.transactionId,
            {
                apple: {
                    transaction: verification.transaction,
                    receiptStatus: verification.raw.status,
                },
            },
            verification.transactionDate,
        );

        return {
            status: 'verified',
            provider: 'apple',
            platform: dto.platform || 'ios',
            product: {
                id: product.id,
                code: product.code,
                title: product.title,
                type: product.type,
                quantity: product.quantity,
            },
            balances,
        };
    }

    private async verifyReceipt(
        dto: VerifyApplePurchaseDto,
        expectedProductId: string,
    ): Promise<AppleReceiptVerification> {
        const receiptData = String(dto.receiptData || '').trim();
        if (!receiptData) {
            throw new BadRequestException('receiptData is required');
        }

        const sharedSecret =
            this.configService.get<string>('apple.sharedSecret') ||
            process.env.APPLE_SHARED_SECRET ||
            process.env.APP_STORE_SHARED_SECRET ||
            '';
        const payload: Record<string, any> = {
            'receipt-data': receiptData,
            'exclude-old-transactions': true,
        };
        if (sharedSecret.trim()) {
            payload.password = sharedSecret.trim();
        }

        let raw = await this.postVerifyReceipt('https://buy.itunes.apple.com/verifyReceipt', payload);
        if (raw.status === 21007) {
            raw = await this.postVerifyReceipt('https://sandbox.itunes.apple.com/verifyReceipt', payload);
        }

        if (raw.status !== 0) {
            throw new BadRequestException(`Apple receipt verification failed with status ${raw.status}`);
        }

        const transaction = this.findReceiptTransaction(raw, expectedProductId, dto.transactionId);
        if (!transaction) {
            throw new BadRequestException('Apple receipt does not contain the requested product transaction');
        }

        const transactionId = String(transaction.transaction_id || dto.transactionId || '').trim();
        if (!transactionId) {
            throw new BadRequestException('Apple transaction id is missing from receipt');
        }

        return {
            raw,
            transaction,
            transactionId,
            originalTransactionId: String(transaction.original_transaction_id || '').trim() || null,
            expiryDate: this.parseAppleMsDate(transaction.expires_date_ms),
            transactionDate:
                this.parseAppleMsDate(transaction.purchase_date_ms) ||
                this.resolveTransactionDate(dto.transactionDate),
        };
    }

    private async postVerifyReceipt(url: string, payload: Record<string, any>): Promise<Record<string, any>> {
        let response: any;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`[APPLE_PAYMENT] verifyReceipt network error: ${message}`);
            throw new ServiceUnavailableException('Apple receipt verification is temporarily unavailable');
        }

        const raw = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new ServiceUnavailableException('Apple receipt verification is temporarily unavailable');
        }
        return raw;
    }

    private findReceiptTransaction(
        raw: Record<string, any>,
        productId: string,
        requestedTransactionId?: string,
    ): Record<string, any> | null {
        const candidates = [
            ...(Array.isArray(raw.latest_receipt_info) ? raw.latest_receipt_info : []),
            ...(Array.isArray(raw.receipt?.in_app) ? raw.receipt.in_app : []),
        ].filter((item) => item && String(item.product_id || '').trim() === productId);

        if (requestedTransactionId) {
            const requested = candidates.find(
                (item) => String(item.transaction_id || '').trim() === String(requestedTransactionId).trim(),
            );
            if (requested) return requested;
        }

        return candidates.sort((a, b) => {
            const aDate = Number(a.expires_date_ms || a.purchase_date_ms || 0);
            const bDate = Number(b.expires_date_ms || b.purchase_date_ms || 0);
            return bDate - aDate;
        })[0] || null;
    }

    private async resolveApplePlan(productId: string): Promise<Plan> {
        const plan = await this.planRepo.findOne({
            where: { iosProductId: productId, isActive: true },
        });
        if (!plan) {
            throw new BadRequestException(`No active plan mapped to App Store product ID '${productId}'`);
        }
        return plan;
    }

    private resolveExpiryDate(plan: Plan, appleExpiryDate: Date | null, startDate: Date): Date {
        if (appleExpiryDate && appleExpiryDate > startDate) {
            return appleExpiryDate;
        }
        const durationDays = Number(plan.durationDays || 30);
        return new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);
    }

    private resolveTransactionDate(raw?: string): Date {
        if (!raw) return new Date();
        const numeric = Number(raw);
        if (Number.isFinite(numeric)) {
            const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
            return new Date(milliseconds);
        }
        const parsed = new Date(raw);
        return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    }

    private parseAppleMsDate(value: unknown): Date | null {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) return null;
        return new Date(numeric);
    }

    private async ensureUserExists(userId: string): Promise<void> {
        const exists = await this.userRepo.exist({ where: { id: userId } });
        if (!exists) throw new BadRequestException('User not found');
    }

    private isSubscriptionStillActive(subscription: Subscription): boolean {
        if (!subscription.endDate) return true;
        return subscription.endDate.getTime() > Date.now();
    }

    private serializePlan(plan: Plan) {
        return {
            id: plan.id,
            code: plan.code,
            name: plan.name,
            price: Number(plan.price),
            currency: plan.currency,
            billingCycle: plan.billingCycle,
            durationDays: plan.durationDays,
            iosProductId: plan.iosProductId,
        };
    }

    private serializeSubscription(subscription: Subscription) {
        return {
            id: subscription.id,
            plan: subscription.plan,
            planId: subscription.planId,
            status: subscription.status,
            startDate: subscription.startDate,
            endDate: subscription.endDate,
            paymentProvider: subscription.paymentProvider,
            appleProductId: subscription.appleProductId,
            appleTransactionId: subscription.appleTransactionId,
            appleOriginalTransactionId: subscription.appleOriginalTransactionId,
        };
    }

    private buildEntitlementSnapshot(plan: Plan) {
        return {
            entitlements: plan.entitlements || {},
            features: plan.featureFlags || {},
            limits: plan.limits || {},
        };
    }
}

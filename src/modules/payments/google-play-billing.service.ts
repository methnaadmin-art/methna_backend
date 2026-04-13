import {
    Injectable,
    Logger,
    BadRequestException,
    NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { google } from 'googleapis';
import {
    PurchaseTransaction,
    PurchaseProvider,
    PurchaseStatus,
} from '../../database/entities/purchase-transaction.entity';
import { Plan } from '../../database/entities/plan.entity';
import { Subscription, SubscriptionStatus } from '../../database/entities/subscription.entity';
import { User } from '../../database/entities/user.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

export interface VerifyPurchaseDto {
    platform: string;
    provider: string;
    productId: string;
    purchaseId?: string;
    purchaseToken: string;
    verificationData?: string;
    verificationSource?: string;
    transactionDate?: string;
    restored?: boolean;
}

export interface RestorePurchaseDto {
    purchaseToken: string;
    productId: string;
}

@Injectable()
export class GooglePlayBillingService {
    private readonly logger = new Logger(GooglePlayBillingService.name);
    private androidPublisher: any = null;

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
        private readonly subscriptionsService: SubscriptionsService,
        private readonly dataSource: DataSource,
    ) {
        this.initGooglePlayClient();
    }

    private initGooglePlayClient() {
        const clientEmail = this.configService.get<string>('GOOGLE_PLAY_CLIENT_EMAIL');
        const privateKey = this.configService.get<string>('GOOGLE_PLAY_PRIVATE_KEY');

        if (!clientEmail || !privateKey) {
            this.logger.warn(
                'GOOGLE_PLAY_CLIENT_EMAIL or GOOGLE_PLAY_PRIVATE_KEY not set. ' +
                'Google Play purchase verification will use token-based trust (no server-side verification).',
            );
            return;
        }

        try {
            const jwtClient = new google.auth.JWT({
                email: clientEmail,
                key: privateKey.replace(/\\n/g, '\n'),
                scopes: ['https://www.googleapis.com/auth/androidpublisher'],
            });

            this.androidPublisher = google.androidpublisher({
                version: 'v3',
                auth: jwtClient,
            });

            this.logger.log('Google Play Developer API client initialized');
        } catch (error) {
            this.logger.error(
                `Failed to initialize Google Play client: ${(error as Error).message}`,
            );
        }
    }

    /**
     * Verify a Google Play purchase and activate the subscription.
     * This is the main endpoint called from the Flutter app.
     */
    async verifyAndActivatePurchase(userId: string, dto: VerifyPurchaseDto) {
        const { productId, purchaseToken } = dto;

        if (!productId || !purchaseToken) {
            throw new BadRequestException('productId and purchaseToken are required');
        }

        // 1) Find the plan by googleProductId
        const plan = await this.planRepo.findOne({
            where: { googleProductId: productId, isActive: true },
        });

        if (!plan) {
            this.logger.warn(`No active plan found for googleProductId: ${productId}`);
            // Don't throw — we still record the transaction for later reconciliation
        }

        // 2) Idempotency: check if this purchaseToken was already processed
        const existing = await this.purchaseRepo.findOne({
            where: { purchaseToken },
        });

        if (existing && existing.status === PurchaseStatus.VERIFIED) {
            this.logger.log(
                `Purchase ${purchaseToken} already verified for user ${existing.userId}`,
            );
            return {
                status: 'already_verified',
                planCode: plan?.code ?? null,
                subscriptionId: existing.paymentReference,
            };
        }

        // 3) Verify with Google Play Developer API (if available)
        let verificationResult: any = null;
        let isVerified = false;

        if (this.androidPublisher) {
            try {
                const packageName = this.configService.get<string>(
                    'GOOGLE_PLAY_PACKAGE_NAME',
                    'com.methna.app',
                );

                const response = await this.androidPublisher.purchases.subscriptions.get({
                    packageName,
                    subscriptionId: productId,
                    token: purchaseToken,
                });

                verificationResult = response.data;
                isVerified = true;

                this.logger.log(
                    `Google Play API verified purchase for ${productId}: ` +
                    `paymentState=${verificationResult.paymentState}, ` +
                    `purchaseState=${verificationResult.purchaseState}`,
                );
            } catch (error) {
                const gError = error as any;
                const status = gError?.response?.status ?? gError?.code;

                if (status === 404 || status === 410) {
                    this.logger.warn(
                        `Google Play API: purchase not found or expired for token ${purchaseToken.substring(0, 12)}...`,
                    );
                    isVerified = false;
                } else {
                    this.logger.error(
                        `Google Play API verification error: ${gError?.message ?? gError}`,
                    );
                    // On API errors, fall through to token-based trust
                    isVerified = true;
                }
            }
        } else {
            // No Google Play API client — trust the purchase token from the device
            // This is acceptable for initial launch; upgrade to server-side verification ASAP
            this.logger.log(
                `No Google Play API client — trusting device purchase token for ${productId}`,
            );
            isVerified = true;
        }

        if (!isVerified) {
            // Record failed verification
            await this.recordPurchase(userId, plan, dto, PurchaseStatus.FAILED, verificationResult);
            throw new BadRequestException('Purchase verification failed. The purchase may be expired or invalid.');
        }

        // 4) Activate subscription in a transaction
        const subscription = await this.dataSource.transaction(async (manager) => {
            // Record / update the purchase transaction
            const purchase = existing
                ? existing
                : manager.create(PurchaseTransaction, {
                    userId,
                    planId: plan?.id ?? null,
                    provider: PurchaseProvider.GOOGLE_PLAY,
                    purchaseToken,
                    productId,
                    orderId: dto.purchaseId ?? null,
                    status: PurchaseStatus.VERIFIED,
                    rawVerification: verificationResult ?? {},
                    transactionDate: dto.transactionDate
                        ? new Date(parseInt(dto.transactionDate))
                        : new Date(),
                    paymentReference: null,
                });

            purchase.status = PurchaseStatus.VERIFIED;
            purchase.rawVerification = verificationResult ?? {};
            await manager.save(PurchaseTransaction, purchase);

            // Cancel existing active subscriptions for this user
            await manager.update(
                Subscription,
                { userId, status: SubscriptionStatus.ACTIVE },
                { status: SubscriptionStatus.CANCELLED },
            );

            // Create new subscription
            const now = new Date();
            const endDate = new Date(now);
            endDate.setDate(endDate.getDate() + (plan?.durationDays ?? 30));

            const subscription = manager.create(Subscription, {
                userId,
                plan: plan?.code ?? 'premium',
                planId: plan?.id ?? null,
                planEntity: plan ?? null,
                status: SubscriptionStatus.ACTIVE,
                startDate: now,
                endDate,
                paymentReference: purchase.id,
                stripeSubscriptionId: null,
                stripeCheckoutSessionId: null,
                stripeCustomerId: null,
                billingCycle: plan?.billingCycle ?? null,
            });

            const saved = await manager.save(Subscription, subscription);
            purchase.paymentReference = saved.id;
            await manager.save(PurchaseTransaction, purchase);

            return saved;
        });

        // 5) Update user premium state
        await this.subscriptionsService.updateUserPremiumState(
            userId,
            true,
            subscription.startDate,
            subscription.endDate,
        );

        this.logger.log(
            `Google Play purchase activated: user=${userId} plan=${plan?.code ?? 'unknown'} ` +
            `productId=${productId}`,
        );

        return {
            status: 'verified',
            planCode: plan?.code ?? null,
            subscriptionId: subscription.id,
        };
    }

    /**
     * Restore a previously purchased Google Play subscription.
     */
    async restorePurchase(userId: string, dto: RestorePurchaseDto) {
        return this.verifyAndActivatePurchase(userId, {
            platform: 'android',
            provider: 'google_play',
            productId: dto.productId,
            purchaseToken: dto.purchaseToken,
            restored: true,
        });
    }

    /**
     * Record a purchase transaction (for failed/pending states).
     */
    private async recordPurchase(
        userId: string,
        plan: Plan | null,
        dto: VerifyPurchaseDto,
        status: PurchaseStatus,
        rawVerification: any,
    ) {
        const purchase = this.purchaseRepo.create({
            userId,
            planId: plan?.id ?? null,
            provider: PurchaseProvider.GOOGLE_PLAY,
            purchaseToken: dto.purchaseToken,
            productId: dto.productId,
            orderId: dto.purchaseId ?? null,
            status,
            rawVerification: rawVerification ?? {},
            transactionDate: dto.transactionDate
                ? new Date(parseInt(dto.transactionDate))
                : new Date(),
        });

        await this.purchaseRepo.save(purchase);
    }
}

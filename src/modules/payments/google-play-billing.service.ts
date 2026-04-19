import {
    BadRequestException,
    Injectable,
    Logger,
    ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { google } from 'googleapis';
import {
    Plan,
    PlanEntitlements,
    PlanFeatureFlags,
    PlanLimits,
} from '../../database/entities/plan.entity';
import {
    PurchaseProvider,
    PurchaseStatus,
    PurchaseTransaction,
} from '../../database/entities/purchase-transaction.entity';
import {
    Subscription,
    SubscriptionStatus,
} from '../../database/entities/subscription.entity';
import {
    ConsumableProduct,
    ConsumableType,
} from '../../database/entities/consumable-product.entity';
import { User } from '../../database/entities/user.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { ConsumableService } from '../consumables/consumable.service';

export interface VerifyPurchaseDto {
    platform?: string;
    provider?: string;
    productId: string;
    basePlanId?: string;
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
    basePlanId?: string;
}

interface GooglePlayVerificationSnapshot {
    raw: Record<string, any>;
    verified: boolean;
    orderId: string | null;
    expiryDate: Date | null;
    autoRenewing: boolean;
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
        @InjectRepository(ConsumableProduct)
        private readonly consumableProductRepo: Repository<ConsumableProduct>,
        private readonly subscriptionsService: SubscriptionsService,
        private readonly consumableService: ConsumableService,
        private readonly dataSource: DataSource,
    ) {
        this.initGooglePlayClient();
    }

    async verifyAndActivatePurchase(userId: string, dto: VerifyPurchaseDto) {
        const productId = String(dto.productId || '').trim();
        const purchaseToken = String(dto.purchaseToken || '').trim();
        const provider = String(dto.provider || 'google_play').trim().toLowerCase();
        const platform = String(dto.platform || 'android').trim().toLowerCase();

        if (!productId || !purchaseToken) {
            throw new BadRequestException('productId and purchaseToken are required');
        }
        if (provider !== 'google_play') {
            throw new BadRequestException('Only google_play provider is supported.');
        }
        if (platform !== 'android') {
            throw new BadRequestException('Google Play verification is only valid for Android platform.');
        }

        this.logger.log(
            `[PAYMENT] Token received user=${userId} provider=${provider} productId=${productId} purchaseToken=${this.maskToken(
                purchaseToken,
            )} restored=${!!dto.restored}`,
        );

        await this.ensureUserExists(userId);

        // PAYMENT FIX: Check if this is a consumable product first
        const consumableProduct = await this.consumableProductRepo.findOne({
            where: { googleProductId: productId, isActive: true, isArchived: false },
        });

        if (consumableProduct) {
            // This is a consumable purchase - delegate to consumable handler
            return this.verifyAndGrantConsumablePurchase(
                userId,
                consumableProduct.id,
                purchaseToken,
                provider as any,
                dto,
            );
        }

        // Otherwise, treat as subscription
        const plan = await this.resolveGooglePlayPlan(productId, dto.basePlanId);

        const existingPurchase = await this.purchaseRepo.findOne({ where: { purchaseToken } });
        if (existingPurchase?.status === PurchaseStatus.VERIFIED) {
            const existingSubscription = await this.subscriptionRepo.findOne({
                where: [
                    { id: existingPurchase.paymentReference || undefined },
                    { userId, googlePurchaseToken: purchaseToken },
                ],
                relations: ['planEntity'],
                order: { updatedAt: 'DESC' },
            });

            if (existingSubscription && this.isSubscriptionStillActive(existingSubscription)) {
                await this.subscriptionsService.syncUserPremiumState(userId);
                this.logger.log(
                    `[PAYMENT] Purchase already verified user=${userId} productId=${productId} subscriptionId=${existingSubscription.id}`,
                );
                return {
                    status: 'already_verified',
                    provider: 'google_play',
                    plan: this.serializePlan(plan),
                    subscription: this.serializeSubscription(existingSubscription),
                    entitlements: this.buildEntitlementSnapshot(plan),
                };
            }
        }

        const verification = await this.verifyWithGooglePlay(productId, purchaseToken);
        if (!verification.verified) {
            this.logger.warn(
                `[PAYMENT] Verification failed user=${userId} productId=${productId} purchaseToken=${this.maskToken(
                    purchaseToken,
                )}`,
            );
            await this.recordFailedPurchase(userId, plan, dto, verification.raw);
            throw this.buildInvalidVerificationException(verification.raw);
        }

        this.logger.log(
            `[PAYMENT] Verification success user=${userId} productId=${productId} orderId=${verification.orderId || 'n/a'} expiry=${
                verification.expiryDate?.toISOString() || 'n/a'
            }`,
        );

        const transactionDate = this.resolveTransactionDate(dto.transactionDate);
        const expiryDate = verification.expiryDate || this.defaultExpiryFromPlan(plan, transactionDate);

        const subscription = await this.dataSource.transaction(async (manager) => {
            const purchaseRepository = manager.getRepository(PurchaseTransaction);
            const subscriptionRepository = manager.getRepository(Subscription);

            const purchase = existingPurchase || purchaseRepository.create({
                userId,
                planId: plan.id,
                provider: PurchaseProvider.GOOGLE_PLAY,
                purchaseToken,
                productId,
                orderId: dto.purchaseId || verification.orderId,
                status: PurchaseStatus.PENDING,
                rawVerification: {},
                transactionDate,
                expiryDate,
                paymentReference: null,
            });

            purchase.userId = userId;
            purchase.planId = plan.id;
            purchase.provider = PurchaseProvider.GOOGLE_PLAY;
            purchase.purchaseToken = purchaseToken;
            purchase.productId = productId;
            purchase.orderId = dto.purchaseId || verification.orderId;
            purchase.status = PurchaseStatus.VERIFIED;
            purchase.rawVerification = {
                ...(purchase.rawVerification || {}),
                verifiedAt: new Date().toISOString(),
                restored: !!dto.restored,
                verificationSource: dto.verificationSource || null,
                verificationData: dto.verificationData || null,
                googlePlay: verification.raw,
            };
            purchase.transactionDate = transactionDate;
            purchase.expiryDate = expiryDate;

            const savedPurchase = await purchaseRepository.save(purchase);

            await subscriptionRepository.update(
                {
                    userId,
                    status: SubscriptionStatus.ACTIVE,
                },
                {
                    status: SubscriptionStatus.CANCELLED,
                },
            );
            await subscriptionRepository.update(
                {
                    userId,
                    status: SubscriptionStatus.PENDING_CANCELLATION,
                },
                {
                    status: SubscriptionStatus.CANCELLED,
                },
            );
            await subscriptionRepository.update(
                {
                    userId,
                    status: SubscriptionStatus.PAST_DUE,
                },
                {
                    status: SubscriptionStatus.CANCELLED,
                },
            );
            await subscriptionRepository.update(
                {
                    userId,
                    status: SubscriptionStatus.TRIAL,
                },
                {
                    status: SubscriptionStatus.CANCELLED,
                },
            );

            const createdSubscription = subscriptionRepository.create({
                userId,
                plan: plan.code,
                planId: plan.id,
                planEntity: plan,
                // If Google Play reports autoRenewing=false, the user has cancelled
                // auto-renew through the Play Store. Set PENDING_CANCELLATION so the
                // subscription remains active until endDate but won't renew.
                status: verification.autoRenewing
                    ? SubscriptionStatus.ACTIVE
                    : SubscriptionStatus.PENDING_CANCELLATION,
                startDate: transactionDate,
                endDate: expiryDate,
                paymentReference: savedPurchase.id,
                paymentProvider: PurchaseProvider.GOOGLE_PLAY,
                googleProductId: productId,
                googlePurchaseToken: purchaseToken,
                googleOrderId: dto.purchaseId || verification.orderId,
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
            `[PAYMENT] Premium activated user=${userId} productId=${productId} subscriptionId=${subscription.id} until=${
                subscription.endDate?.toISOString() || 'n/a'
            }`,
        );

        return {
            status: 'verified',
            provider: 'google_play',
            restored: !!dto.restored,
            plan: this.serializePlan(plan),
            subscription: this.serializeSubscription(subscription),
            entitlements: this.buildEntitlementSnapshot(plan),
        };
    }

    async restorePurchase(userId: string, dto: RestorePurchaseDto) {
        this.logger.log(
            `[PAYMENT] Restore flow started user=${userId} productId=${dto.productId} purchaseToken=${this.maskToken(
                dto.purchaseToken,
            )}`,
        );

        const result = await this.verifyAndActivatePurchase(userId, {
            platform: 'android',
            provider: 'google_play',
            productId: dto.productId,
            basePlanId: dto.basePlanId,
            purchaseToken: dto.purchaseToken,
            restored: true,
        });

        this.logger.log(
            `[PAYMENT] Restore flow completed user=${userId} productId=${dto.productId} status=${result.status}`,
        );

        return result;
    }

    /**
     * PAYMENT FIX: Verify and grant consumable purchase.
     * This verifies the purchase with Google Play and then grants the consumables to the user.
     */
    private async verifyAndGrantConsumablePurchase(
        userId: string,
        consumableProductId: string,
        purchaseToken: string,
        provider: PurchaseProvider,
        dto: VerifyPurchaseDto,
    ): Promise<{ status: string; granted: boolean; balances: any }> {
        const productId = String(dto.productId || '').trim();

        // Verify with Google Play
        const verification = await this.verifyConsumableWithGooglePlay(productId, purchaseToken);
        if (!verification.verified) {
            this.logger.warn(
                `[PAYMENT] Consumable verification failed user=${userId} productId=${productId} purchaseToken=${this.maskToken(
                    purchaseToken,
                )}`,
            );
            throw this.buildInvalidVerificationException(verification.raw);
        }

        this.logger.log(
            `[PAYMENT] Consumable verification success user=${userId} productId=${productId} orderId=${verification.orderId || 'n/a'}`,
        );

        const transactionDate = this.resolveTransactionDate(dto.transactionDate);

        // Grant the consumable balance to the user
        const grantResult = await this.consumableService.grantBalance(
            userId,
            consumableProductId,
            provider,
            purchaseToken,
            verification.orderId || undefined,
            { googlePlay: verification.raw },
            transactionDate,
        );

        this.logger.log(
            `[PAYMENT] Consumable granted user=${userId} productId=${productId} granted=${grantResult.granted}`,
        );

        return {
            status: grantResult.granted ? 'verified_granted' : 'already_granted',
            granted: grantResult.granted,
            balances: grantResult.balances,
        };
    }

    /**
     * Verify a consumable (one-time) Google Play purchase.
     * Uses purchases.products.get instead of purchases.subscriptions.get.
     * Returns verification snapshot without creating a subscription.
     */
    async verifyAndActivateConsumablePurchase(
        userId: string,
        consumableProductId: string,
        dto: VerifyPurchaseDto,
    ): Promise<{ verified: boolean; rawVerification: Record<string, any>; transactionDate: Date | null }> {
        const productId = String(dto.productId || '').trim();
        const purchaseToken = String(dto.purchaseToken || '').trim();

        if (!productId || !purchaseToken) {
            throw new BadRequestException('productId and purchaseToken are required');
        }

        this.logger.log(
            `[PAYMENT] Consumable token received user=${userId} productId=${productId} purchaseToken=${this.maskToken(
                purchaseToken,
            )} backendProductId=${consumableProductId}`,
        );

        await this.ensureUserExists(userId);

        // Check for duplicate purchase token (idempotency)
        const existingPurchase = await this.purchaseRepo.findOne({ where: { purchaseToken } });
        if (existingPurchase?.status === PurchaseStatus.VERIFIED) {
            return {
                verified: true,
                rawVerification: existingPurchase.rawVerification || {},
                transactionDate: existingPurchase.transactionDate,
            };
        }

        // Verify with Google Play using products.get (consumable, not subscription)
        const verification = await this.verifyConsumableWithGooglePlay(productId, purchaseToken);
        if (!verification.verified) {
            this.logger.warn(
                `[PAYMENT] Consumable verification failed user=${userId} productId=${productId} purchaseToken=${this.maskToken(
                    purchaseToken,
                )}`,
            );
            await this.recordFailedPurchase(userId, null, dto, verification.raw);
            throw this.buildInvalidVerificationException(verification.raw);
        }

        this.logger.log(
            `[PAYMENT] Consumable verification success user=${userId} productId=${productId} orderId=${verification.orderId || 'n/a'}`,
        );

        const transactionDate = this.resolveTransactionDate(dto.transactionDate);

        this.logger.log(
            `Consumable purchase verified: user=${userId} productId=${productId} backendProductId=${consumableProductId}`,
        );

        return {
            verified: true,
            rawVerification: {
                verifiedAt: new Date().toISOString(),
                purchaseType: 'consumable',
                googlePlay: verification.raw,
            },
            transactionDate,
        };
    }

    private async ensureUserExists(userId: string): Promise<void> {
        const user = await this.userRepo.findOne({ where: { id: userId }, select: ['id'] });
        if (!user) {
            throw new BadRequestException('User not found');
        }
    }

    private async resolveGooglePlayPlan(productId: string, basePlanId?: string): Promise<Plan> {
        const normalizedBasePlanId = String(basePlanId || '').trim();

        if (normalizedBasePlanId) {
            const plan = await this.planRepo.findOne({
                where: {
                    googleProductId: productId,
                    googleBasePlanId: normalizedBasePlanId,
                    isActive: true,
                },
            });

            if (!plan) {
                throw new BadRequestException(
                    `No active plan mapped to googleProductId '${productId}' + googleBasePlanId '${normalizedBasePlanId}'`,
                );
            }

            return plan;
        }

        const plans = await this.planRepo.find({
            where: {
                googleProductId: productId,
                isActive: true,
            },
            order: {
                createdAt: 'ASC',
            },
        });

        if (plans.length === 0) {
            throw new BadRequestException(`No active plan mapped to googleProductId '${productId}'`);
        }

        if (plans.length > 1) {
            throw new BadRequestException(
                `Multiple plans are mapped to googleProductId '${productId}'. Provide basePlanId for deterministic mapping.`,
            );
        }

        return plans[0];
    }

    private resolveTransactionDate(transactionDate?: string): Date {
        const parsed = Number(transactionDate || 0);
        if (Number.isFinite(parsed) && parsed > 0) {
            return new Date(parsed);
        }
        return new Date();
    }

    private defaultExpiryFromPlan(plan: Plan, startDate: Date): Date {
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + (plan.durationDays || 30));
        return endDate;
    }

    private async verifyWithGooglePlay(productId: string, purchaseToken: string): Promise<GooglePlayVerificationSnapshot> {
        if (!this.androidPublisher) {
            if (!this.isVerificationBypassEnabled()) {
                throw new BadRequestException('Google Play developer API credentials are missing on backend.');
            }

            this.logger.warn(
                `[GooglePlay] GOOGLE_PLAY_ALLOW_UNVERIFIED_TOKENS=true, trusting purchase token for productId=${productId}`,
            );

            return {
                verified: true,
                orderId: null,
                expiryDate: null,
                autoRenewing: true, // Assume renewing when bypass is active
                raw: {
                    verificationMode: 'trusted_device_token',
                    warning: 'Server-side Google Play verification bypass is enabled',
                },
            };
        }

        const packageName = this.resolvePackageName();
        this.logger.log(
            `[PAYMENT] Calling Google API subscription verify package=${packageName} productId=${productId} purchaseToken=${this.maskToken(
                purchaseToken,
            )}`,
        );

        try {
            const response = await this.androidPublisher.purchases.subscriptions.get({
                packageName,
                subscriptionId: productId,
                token: purchaseToken,
            });

            const payload = response?.data || {};
            const paymentState = Number(payload.paymentState);
            const purchaseState = Number(payload.purchaseState);
            const expiryTimeMillis = Number(payload.expiryTimeMillis || 0);
            const expiryDate = Number.isFinite(expiryTimeMillis) && expiryTimeMillis > 0
                ? new Date(expiryTimeMillis)
                : null;
            const autoRenewing = payload.autoRenewing === true || payload.autoRenewing === 'true';

            const purchased = !Number.isFinite(paymentState) || paymentState === 1 || paymentState === 2;
            const notCancelledBeforePurchase = !Number.isFinite(purchaseState) || purchaseState === 0;
            const notExpired = !expiryDate || expiryDate.getTime() > Date.now();

            this.logger.log(
                `[PAYMENT] Google API response received productId=${productId} paymentState=${paymentState} purchaseState=${purchaseState} autoRenewing=${autoRenewing} orderId=${
                    typeof payload.orderId === 'string' ? payload.orderId : 'n/a'
                } expiresAt=${expiryDate?.toISOString() || 'n/a'}`,
            );

            return {
                verified: purchased && notCancelledBeforePurchase && notExpired,
                orderId: typeof payload.orderId === 'string' ? payload.orderId : null,
                expiryDate,
                autoRenewing,
                raw: payload,
            };
        } catch (error) {
            const gError: any = error;
            const status =
                gError?.response?.status ??
                gError?.code ??
                gError?.status ??
                gError?.message;
            const reason = this.resolveGooglePlayFailureReason(status);
            this.logger.error(
                `[GooglePlay] verification failed for productId=${productId}, status=${status}: ${gError?.message || gError}`,
            );

            if (this.shouldTrustTokenWhenGoogleUnavailable(purchaseToken, reason)) {
                this.logger.warn(
                    `[GooglePlay] Non-production fallback accepted synthetic token for subscription productId=${productId} status=${status} reason=${reason}`,
                );
                return {
                    verified: true,
                    orderId: null,
                    expiryDate: null,
                    autoRenewing: true, // Assume renewing in fallback mode
                    raw: {
                        status,
                        reason,
                        verificationMode: 'qa_synthetic_token_fallback',
                        warning:
                            'Google Play API was unavailable for backend verification; non-production synthetic token fallback used.',
                    },
                };
            }

            return {
                verified: false,
                orderId: null,
                expiryDate: null,
                autoRenewing: false,
                raw: {
                    status,
                    reason,
                    error: gError?.message || 'Google Play verification error',
                },
            };
        }
    }

    private resolvePackageName(): string {
        return (
            this.configService.get<string>('GOOGLE_PLAY_PACKAGE_NAME') ||
            this.configService.get<string>('googlePlay.packageName') ||
            'com.methnapp.app'
        ).trim();
    }

    /**
     * Verify a consumable (one-time) purchase using Google Play purchases.products.get.
     * Unlike subscriptions, consumables have no expiry — they are consumed once.
     */
    private async verifyConsumableWithGooglePlay(productId: string, purchaseToken: string): Promise<GooglePlayVerificationSnapshot> {
        if (!this.androidPublisher) {
            if (!this.isVerificationBypassEnabled()) {
                throw new BadRequestException('Google Play developer API credentials are missing on backend.');
            }

            this.logger.warn(
                `[GooglePlay] GOOGLE_PLAY_ALLOW_UNVERIFIED_TOKENS=true, trusting consumable purchase token for productId=${productId}`,
            );

            return {
                verified: true,
                orderId: null,
                expiryDate: null,
                autoRenewing: true, // Not applicable for consumables
                raw: {
                    verificationMode: 'trusted_device_token',
                    purchaseType: 'consumable',
                    warning: 'Server-side Google Play verification bypass is enabled',
                },
            };
        }

        const packageName = this.resolvePackageName();
        this.logger.log(
            `[PAYMENT] Calling Google API consumable verify package=${packageName} productId=${productId} purchaseToken=${this.maskToken(
                purchaseToken,
            )}`,
        );

        try {
            // Use products.get for consumable purchases (not subscriptions.get)
            const response = await this.androidPublisher.purchases.products.get({
                packageName,
                productId,
                token: purchaseToken,
            });

            const payload = response?.data || {};
            const purchaseState = Number(payload.purchaseState);
            const consumptionState = Number(payload.consumptionState);

            // purchaseState: 0 = purchased, 1 = cancelled.
            // Backend idempotency is enforced by purchaseToken. Accepting an already
            // consumed token lets valid client-consumed purchases be reconciled instead
            // of trapping users after Google Play checkout succeeds.
            const isPurchased = !Number.isFinite(purchaseState) || purchaseState === 0;

            this.logger.log(
                `[PAYMENT] Google API consumable response productId=${productId} purchaseState=${purchaseState} consumptionState=${consumptionState} orderId=${
                    typeof payload.orderId === 'string' ? payload.orderId : 'n/a'
                }`,
            );

            return {
                verified: isPurchased,
                orderId: typeof payload.orderId === 'string' ? payload.orderId : null,
                expiryDate: null, // consumables have no expiry
                autoRenewing: true, // Not applicable for consumables
                raw: payload,
            };
        } catch (error) {
            const gError: any = error;
            const status =
                gError?.response?.status ??
                gError?.code ??
                gError?.status ??
                gError?.message;
            const reason = this.resolveGooglePlayFailureReason(status);
            this.logger.error(
                `[GooglePlay] consumable verification failed for productId=${productId}, status=${status}: ${gError?.message || gError}`,
            );

            if (this.shouldTrustTokenWhenGoogleUnavailable(purchaseToken, reason)) {
                this.logger.warn(
                    `[GooglePlay] Non-production fallback accepted synthetic token for consumable productId=${productId} status=${status} reason=${reason}`,
                );
                return {
                    verified: true,
                    orderId: null,
                    expiryDate: null,
                    autoRenewing: true, // Not applicable for consumables
                    raw: {
                        status,
                        reason,
                        purchaseType: 'consumable',
                        verificationMode: 'qa_synthetic_token_fallback',
                        warning:
                            'Google Play API was unavailable for backend verification; non-production synthetic token fallback used.',
                    },
                };
            }

            return {
                verified: false,
                orderId: null,
                expiryDate: null,
                autoRenewing: false,
                raw: {
                    status,
                    reason,
                    error: gError?.message || 'Google Play consumable verification error',
                },
            };
        }
    }

    private async recordFailedPurchase(
        userId: string,
        plan: Plan | null,
        dto: VerifyPurchaseDto,
        rawVerification: Record<string, any>,
    ): Promise<void> {
        const existing = await this.purchaseRepo.findOne({ where: { purchaseToken: dto.purchaseToken } });

        const purchase = existing || this.purchaseRepo.create({
            userId,
            planId: plan?.id ?? null,
            provider: PurchaseProvider.GOOGLE_PLAY,
            purchaseToken: dto.purchaseToken,
            productId: dto.productId,
            orderId: dto.purchaseId || null,
            status: PurchaseStatus.FAILED,
            rawVerification: {},
            transactionDate: this.resolveTransactionDate(dto.transactionDate),
            expiryDate: null,
            paymentReference: null,
        });

        purchase.userId = userId;
        purchase.planId = plan?.id ?? null;
        purchase.provider = PurchaseProvider.GOOGLE_PLAY;
        purchase.purchaseToken = dto.purchaseToken;
        purchase.productId = dto.productId;
        purchase.orderId = dto.purchaseId || null;
        purchase.status = PurchaseStatus.FAILED;
        purchase.rawVerification = {
            ...(purchase.rawVerification || {}),
            failedAt: new Date().toISOString(),
            restored: !!dto.restored,
            verificationData: dto.verificationData || null,
            verificationSource: dto.verificationSource || null,
            googlePlay: rawVerification || {},
        };

        await this.purchaseRepo.save(purchase);
    }

    private buildEntitlementSnapshot(plan: Plan) {
        const entitlements = this.resolveEntitlements(plan);
        return {
            features: this.toFeatureFlags(plan, entitlements),
            limits: this.toLimits(plan, entitlements),
            entitlements,
        };
    }

    private resolveEntitlements(plan: Plan): PlanEntitlements {
        const entitlements: PlanEntitlements = {
            ...(plan.entitlements || {}),
        };

        if (entitlements.dailyLikes === undefined) {
            entitlements.dailyLikes = plan.dailyLikesLimit;
        }
        if (entitlements.dailySuperLikes === undefined) {
            entitlements.dailySuperLikes = plan.dailySuperLikesLimit;
        }
        if (entitlements.dailyCompliments === undefined) {
            entitlements.dailyCompliments = plan.dailyComplimentsLimit;
        }
        if (entitlements.monthlyRewinds === undefined) {
            entitlements.monthlyRewinds = plan.monthlyRewindsLimit;
        }
        if (entitlements.weeklyBoosts === undefined) {
            entitlements.weeklyBoosts = plan.weeklyBoostsLimit;
        }

        if (entitlements.likesLimit === undefined && entitlements.dailyLikes !== undefined) {
            entitlements.likesLimit = entitlements.dailyLikes;
        }
        if (entitlements.boostsLimit === undefined && entitlements.weeklyBoosts !== undefined) {
            entitlements.boostsLimit = entitlements.weeklyBoosts;
        }
        if (entitlements.complimentsLimit === undefined && entitlements.dailyCompliments !== undefined) {
            entitlements.complimentsLimit = entitlements.dailyCompliments;
        }

        return entitlements;
    }

    private toFeatureFlags(plan: Plan, entitlements: PlanEntitlements): PlanFeatureFlags {
        return {
            ...(plan.featureFlags || {}),
            unlimitedLikes: entitlements.unlimitedLikes,
            unlimitedRewinds: entitlements.unlimitedRewinds,
            advancedFilters: entitlements.advancedFilters,
            seeWhoLikesYou: entitlements.seeWhoLikesYou,
            whoLikedMe: entitlements.whoLikedMe,
            readReceipts: entitlements.readReceipts,
            typingIndicators: entitlements.typingIndicators,
            invisibleMode: entitlements.invisibleMode,
            ghostMode: entitlements.ghostMode,
            passportMode: entitlements.passportMode,
            boost: entitlements.boost,
            likes: entitlements.likes,
            premiumBadge: entitlements.premiumBadge,
            hideAds: entitlements.hideAds,
            rematch: entitlements.rematch,
            videoChat: entitlements.videoChat,
            superLike: entitlements.superLike,
            profileBoostPriority: entitlements.profileBoostPriority,
            priorityMatching: entitlements.priorityMatching,
            improvedVisits: entitlements.improvedVisits,
        };
    }

    private toLimits(plan: Plan, entitlements: PlanEntitlements): PlanLimits {
        return {
            ...(plan.limits || {}),
            dailyLikes: entitlements.dailyLikes,
            dailySuperLikes: entitlements.dailySuperLikes,
            dailyCompliments: entitlements.dailyCompliments,
            monthlyRewinds: entitlements.monthlyRewinds,
            weeklyBoosts: entitlements.weeklyBoosts,
            likesLimit: entitlements.likesLimit,
            boostsLimit: entitlements.boostsLimit,
            complimentsLimit: entitlements.complimentsLimit,
        };
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
            googleProductId: plan.googleProductId,
            googleBasePlanId: plan.googleBasePlanId,
        };
    }

    private serializeSubscription(subscription: Subscription) {
        return {
            id: subscription.id,
            status: subscription.status,
            startDate: subscription.startDate,
            endDate: subscription.endDate,
            paymentProvider: subscription.paymentProvider,
            googleProductId: subscription.googleProductId,
            googleOrderId: subscription.googleOrderId,
        };
    }

    private isSubscriptionStillActive(subscription: Subscription): boolean {
        if (
            subscription.status !== SubscriptionStatus.ACTIVE &&
            subscription.status !== SubscriptionStatus.PENDING_CANCELLATION &&
            subscription.status !== SubscriptionStatus.PAST_DUE &&
            subscription.status !== SubscriptionStatus.TRIAL
        ) {
            return false;
        }

        if (!subscription.endDate) {
            return true;
        }

        return new Date(subscription.endDate).getTime() > Date.now();
    }

    private initGooglePlayClient(): void {
        const clientEmail = this.configService.get<string>('GOOGLE_PLAY_CLIENT_EMAIL');
        const privateKey = this.configService.get<string>('GOOGLE_PLAY_PRIVATE_KEY');

        if (!clientEmail || !privateKey) {
            const message =
                'GOOGLE_PLAY_CLIENT_EMAIL or GOOGLE_PLAY_PRIVATE_KEY not set. Server-side verification disabled unless GOOGLE_PLAY_ALLOW_UNVERIFIED_TOKENS=true.';

            if (this.isProductionEnvironment()) {
                throw new Error(`FATAL: ${message}`);
            }

            this.logger.warn(
                message,
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

            this.logger.log('Google Play Developer API client initialized.');
        } catch (error) {
            if (this.isProductionEnvironment()) {
                throw error;
            }
            this.logger.error(`Failed to initialize Google Play client: ${(error as Error).message}`);
        }
    }

    private isVerificationBypassEnabled(): boolean {
        const allowUnverifiedFromConfig = this.configService.get<boolean>('googlePlay.allowUnverifiedTokens');
        const allowUnverifiedFromEnv =
            this.configService.get<string>('GOOGLE_PLAY_ALLOW_UNVERIFIED_TOKENS') === 'true';
        const allowUnverified =
            typeof allowUnverifiedFromConfig === 'boolean'
                ? allowUnverifiedFromConfig
                : allowUnverifiedFromEnv;
        if (!allowUnverified) {
            return false;
        }

        if (this.isProductionEnvironment()) {
            this.logger.error(
                '[GooglePlay] GOOGLE_PLAY_ALLOW_UNVERIFIED_TOKENS=true is not allowed in production.',
            );
            return false;
        }

        return true;
    }

    private isProductionEnvironment(): boolean {
        const normalized = (
            this.configService.get<string>('NODE_ENV') ||
            this.configService.get<string>('nodeEnv') ||
            ''
        )
            .trim()
            .toLowerCase();
        return normalized === 'production' || normalized === 'prod';
    }

    private resolveGooglePlayFailureReason(status: unknown): string {
        const normalizedStatus = String(status ?? '').trim().toLowerCase();
        const numericStatus = Number(status);
        if (numericStatus === 400) {
            return 'invalid_purchase_token';
        }
        if (numericStatus === 401 || numericStatus === 403) {
            return 'google_play_api_access_or_service_account';
        }
        if (numericStatus === 404) {
            return 'package_product_or_token_not_found';
        }
        if (Number.isFinite(numericStatus) && numericStatus >= 500) {
            return 'google_play_api_unavailable';
        }

        // Node/OpenSSL/network runtime failures should be treated as retryable infrastructure errors.
        if (
            normalizedStatus.includes('err_ossl_unsupported') ||
            normalizedStatus.includes('error:1e08010c') ||
            normalizedStatus.includes('unsupported') ||
            normalizedStatus.includes('econnreset') ||
            normalizedStatus.includes('etimedout') ||
            normalizedStatus.includes('enotfound') ||
            normalizedStatus.includes('eai_again') ||
            normalizedStatus.includes('econnrefused')
        ) {
            return 'google_play_api_unavailable';
        }

        if (
            normalizedStatus.includes('invalid_grant') ||
            normalizedStatus.includes('insufficient authentication scopes')
        ) {
            return 'google_play_api_access_or_service_account';
        }

        return 'google_play_verification_failed';
    }

    private shouldTrustTokenWhenGoogleUnavailable(
        purchaseToken: string,
        reason: string,
    ): boolean {
        if (this.isProductionEnvironment()) {
            return false;
        }

        if (!this.isExternalGoogleConfigurationReason(reason)) {
            return false;
        }

        return this.isVerificationBypassEnabled() || this.isSyntheticQaPurchaseToken(purchaseToken);
    }

    private isExternalGoogleConfigurationReason(reason: string): boolean {
        return [
            'google_play_api_access_or_service_account',
            'package_product_or_token_not_found',
            'google_play_api_unavailable',
        ].includes(reason);
    }

    private isSyntheticQaPurchaseToken(purchaseToken: string): boolean {
        const normalized = String(purchaseToken || '').trim().toLowerCase();
        if (!normalized) {
            return false;
        }

        return (
            /^final-v\d+-/.test(normalized) ||
            normalized.startsWith('qa-') ||
            normalized.startsWith('test-')
        );
    }

    private buildInvalidVerificationException(
        rawVerification?: Record<string, any>,
    ): BadRequestException | ServiceUnavailableException {
        const googleStatus = rawVerification?.status ?? rawVerification?.googleStatus ?? null;
        const reason =
            rawVerification?.reason ??
            (googleStatus == null ? 'google_play_verification_failed' : this.resolveGooglePlayFailureReason(googleStatus));
        const externalConfigurationRequired = [
            'google_play_api_access_or_service_account',
            'package_product_or_token_not_found',
        ].includes(reason);

        const retryable = [
            'google_play_api_access_or_service_account',
            'package_product_or_token_not_found',
            'google_play_api_unavailable',
        ].includes(reason);

        const messageByReason: Record<string, string> = {
            invalid_purchase_token:
                'Google Play rejected this purchase token. Fake, stale, or non-Play test tokens are expected to fail.',
            google_play_api_access_or_service_account:
                'Google Play verification is temporarily unavailable due to backend API access configuration.',
            package_product_or_token_not_found:
                'Google Play could not find this package/product/token combination. Verify product mapping and package configuration.',
            google_play_api_unavailable:
                'Google Play verification is temporarily unavailable. Please retry shortly.',
            google_play_verification_failed:
                'Google Play purchase verification failed.',
        };

        const payload = {
            status: retryable ? 'verification_unavailable' : 'verification_failed',
            error: retryable ? 'Verification temporarily unavailable' : 'Invalid or unverified purchase',
            message: messageByReason[reason] || 'Google Play purchase verification failed.',
            googleStatus,
            reason,
            retryable,
            externalConfigurationRequired,
        };

        if (retryable) {
            return new ServiceUnavailableException(payload);
        }

        return new BadRequestException(payload);
    }

    private maskToken(token: string): string {
        const normalized = token.trim();
        if (!normalized) {
            return 'n/a';
        }

        if (normalized.length <= 12) {
            return normalized;
        }

        return `${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
    }
}

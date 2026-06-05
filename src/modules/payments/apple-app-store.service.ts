import {
    BadRequestException,
    Injectable,
    Logger,
    ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createSign } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import {
    Plan,
    PlanEntitlements,
    PlanFeatureFlags,
    PlanLimits,
} from '../../database/entities/plan.entity';
import { BillingCycle } from '../../database/entities/billing-cycle.enum';
import {
    PurchaseProvider,
    PurchaseStatus,
    PurchaseTransaction,
} from '../../database/entities/purchase-transaction.entity';
import {
    Subscription,
    SubscriptionStatus,
} from '../../database/entities/subscription.entity';
import { User } from '../../database/entities/user.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

export interface VerifyApplePurchaseDto {
    platform?: string;
    provider?: string;
    productId: string;
    transactionId?: string;
    originalTransactionId?: string;
    purchaseToken?: string;
    serverVerificationData?: string;
    verificationData?: string | {
        serverVerificationData?: string;
        localVerificationData?: string;
        source?: string;
    };
    receiptData?: string;
    transactionDate?: string;
    restored?: boolean;
    environment?: string;
}

type AppleEnvironment = 'production' | 'sandbox';

interface AppleApiConfig {
    issuerId: string;
    keyId: string;
    bundleId: string;
    privateKey: string;
}

interface AppleTransactionInfo {
    transactionId?: string;
    originalTransactionId?: string;
    webOrderLineItemId?: string;
    bundleId?: string;
    productId?: string;
    purchaseDate?: number;
    originalPurchaseDate?: number;
    expiresDate?: number;
    revocationDate?: number;
    revocationReason?: number;
    type?: string;
    inAppOwnershipType?: string;
    signedDate?: number;
    environment?: string;
    transactionReason?: string;
    isUpgraded?: boolean;
    appAccountToken?: string;
}

interface AppleRenewalInfo {
    originalTransactionId?: string;
    autoRenewProductId?: string;
    productId?: string;
    autoRenewStatus?: number;
    isInBillingRetryPeriod?: boolean;
    gracePeriodExpiresDate?: number;
    expirationIntent?: number;
    signedDate?: number;
    environment?: string;
}

interface AppleVerificationSnapshot {
    verified: boolean;
    productId: string;
    transactionId: string;
    originalTransactionId: string;
    purchaseDate: Date;
    expiryDate: Date;
    subscriptionStatus: SubscriptionStatus;
    appleStatus: number | null;
    autoRenewStatus: number | null;
    environment: AppleEnvironment;
    raw: Record<string, any>;
}

@Injectable()
export class AppleAppStoreService {
    private readonly logger = new Logger(AppleAppStoreService.name);
    private readonly fallbackAllowedProductIds = new Set([
        'com.methnapp.app.premium_monthly',
        'com.methnapp.app.premium_yearly',
    ]);

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
    ) {}

    async verifyAndActivatePurchase(userId: string, dto: VerifyApplePurchaseDto) {
        const requestedProductId = String(dto.productId || '').trim();
        const provider = String(dto.provider || 'apple').trim().toLowerCase();
        const platform = String(dto.platform || 'ios').trim().toLowerCase();

        if (!requestedProductId) {
            throw new BadRequestException('productId is required');
        }
        await this.assertAllowedProduct(requestedProductId);
        if (!['apple', 'app_store', 'ios'].includes(provider)) {
            throw new BadRequestException('Only Apple App Store provider is supported for this endpoint.');
        }
        if (platform !== 'ios') {
            throw new BadRequestException('Apple purchase verification is only valid for iOS platform.');
        }

        await this.ensureUserExists(userId);

        const verificationInput = this.resolveVerificationInput(dto);
        if (
            !verificationInput.transactionId &&
            !verificationInput.originalTransactionId &&
            !verificationInput.serverVerificationData
        ) {
            throw new BadRequestException(
                'transactionId, originalTransactionId, or purchaseToken/serverVerificationData is required',
            );
        }

        this.logger.log(
            `[PAYMENT] Apple token received user=${userId} productId=${requestedProductId} transactionId=${
                verificationInput.transactionId || 'n/a'
            } originalTransactionId=${verificationInput.originalTransactionId || 'n/a'} restored=${!!dto.restored}`,
        );

        const verification = await this.verifyWithApple(requestedProductId, dto, verificationInput);
        if (!verification.verified) {
            await this.recordFailedPurchase(userId, dto, verificationInput, verification.raw);
            throw new BadRequestException({
                status: 'verification_failed',
                error: 'Invalid or unverified Apple transaction',
                reason: verification.raw?.reason || 'apple_verification_failed',
            });
        }

        const plan = await this.resolveApplePlan(verification.productId);
        const purchaseToken = verification.originalTransactionId;

        const existingPurchase = await this.purchaseRepo.findOne({ where: { purchaseToken } });
        if (existingPurchase?.userId && existingPurchase.userId !== userId) {
            throw new BadRequestException('This Apple subscription is already linked to another account.');
        }
        const linkedSubscription = await this.subscriptionRepo.findOne({
            where: { appleOriginalTransactionId: verification.originalTransactionId },
            select: ['id', 'userId'],
        });
        if (linkedSubscription?.userId && linkedSubscription.userId !== userId) {
            throw new BadRequestException('This Apple subscription is already linked to another account.');
        }

        const existingSubscription = await this.findExistingAppleSubscription(
            userId,
            verification.originalTransactionId,
            existingPurchase?.paymentReference || null,
        );
        const wasAlreadyCurrent =
            !!existingSubscription &&
            this.isSubscriptionStillActive(existingSubscription) &&
            existingSubscription.appleTransactionId === verification.transactionId &&
            this.sameDate(existingSubscription.endDate, verification.expiryDate);

        const subscription = await this.dataSource.transaction(async (manager) => {
            const purchaseRepository = manager.getRepository(PurchaseTransaction);
            const subscriptionRepository = manager.getRepository(Subscription);

            const purchase = existingPurchase || purchaseRepository.create({
                userId,
                planId: plan.id,
                provider: PurchaseProvider.APPLE,
                purchaseToken,
                productId: verification.productId,
                orderId: verification.transactionId,
                status: PurchaseStatus.PENDING,
                rawVerification: {},
                transactionDate: verification.purchaseDate,
                expiryDate: verification.expiryDate,
                paymentReference: null,
            });

            purchase.userId = userId;
            purchase.planId = plan.id;
            purchase.provider = PurchaseProvider.APPLE;
            purchase.purchaseToken = purchaseToken;
            purchase.productId = verification.productId;
            purchase.orderId = verification.transactionId;
            purchase.status = PurchaseStatus.VERIFIED;
            purchase.rawVerification = {
                ...(purchase.rawVerification || {}),
                platform: 'ios',
                verifiedAt: new Date().toISOString(),
                restored: !!dto.restored,
                transactionId: verification.transactionId,
                originalTransactionId: verification.originalTransactionId,
                productId: verification.productId,
                environment: verification.environment,
                appleStatus: verification.appleStatus,
                autoRenewStatus: verification.autoRenewStatus,
                inputSource: verificationInput.source,
                apple: verification.raw,
            };
            purchase.transactionDate = verification.purchaseDate;
            purchase.expiryDate = verification.expiryDate;

            const savedPurchase = await purchaseRepository.save(purchase);

            await this.cancelCurrentSubscriptions(subscriptionRepository, userId);

            const subscriptionToSave = existingSubscription || subscriptionRepository.create({
                userId,
            });

            subscriptionToSave.userId = userId;
            subscriptionToSave.plan = plan.code;
            subscriptionToSave.planId = plan.id;
            subscriptionToSave.planEntity = plan;
            subscriptionToSave.status = verification.subscriptionStatus;
            subscriptionToSave.startDate = verification.purchaseDate;
            subscriptionToSave.endDate = verification.expiryDate;
            subscriptionToSave.paymentReference = savedPurchase.id;
            subscriptionToSave.paymentProvider = PurchaseProvider.APPLE;
            subscriptionToSave.paymentPlatform = 'ios';
            subscriptionToSave.googleProductId = null;
            subscriptionToSave.googlePurchaseToken = null;
            subscriptionToSave.googleOrderId = null;
            subscriptionToSave.appleProductId = verification.productId;
            subscriptionToSave.appleTransactionId = verification.transactionId;
            subscriptionToSave.appleOriginalTransactionId = verification.originalTransactionId;
            subscriptionToSave.appleEnvironment = verification.environment;
            subscriptionToSave.stripeSubscriptionId = null;
            subscriptionToSave.stripeCheckoutSessionId = null;
            subscriptionToSave.stripeCustomerId = null;
            subscriptionToSave.billingCycle = plan.billingCycle;

            const savedSubscription = await subscriptionRepository.save(subscriptionToSave);
            savedPurchase.paymentReference = savedSubscription.id;
            await purchaseRepository.save(savedPurchase);

            return savedSubscription;
        });

        await this.subscriptionsService.syncUserPremiumState(userId);

        this.logger.log(
            `[PAYMENT] Apple premium activated user=${userId} productId=${verification.productId} subscriptionId=${
                subscription.id
            } until=${verification.expiryDate.toISOString()} environment=${verification.environment}`,
        );

        return {
            status: wasAlreadyCurrent ? 'already_verified' : 'verified',
            provider: 'apple',
            platform: 'ios',
            restored: !!dto.restored,
            environment: verification.environment,
            plan: this.serializePlan(plan),
            subscription: this.serializeSubscription(subscription),
            entitlements: this.buildEntitlementSnapshot(plan),
        };
    }

    private async verifyWithApple(
        requestedProductId: string,
        dto: VerifyApplePurchaseDto,
        input: {
            transactionId: string;
            originalTransactionId: string;
            serverVerificationData: string;
            source: string;
        },
    ): Promise<AppleVerificationSnapshot> {
        const jwsPayload = this.decodeJwsPayload<AppleTransactionInfo>(input.serverVerificationData);
        const transactionId =
            input.transactionId ||
            jwsPayload?.transactionId ||
            (this.looksLikeTransactionId(input.serverVerificationData) ? input.serverVerificationData : '');
        const originalTransactionId = input.originalTransactionId || jwsPayload?.originalTransactionId || '';

        if (transactionId) {
            try {
                return await this.verifyTransactionWithAppStoreServerApi(requestedProductId, transactionId, dto);
            } catch (error) {
                if (this.canFallbackToReceiptVerification(input.serverVerificationData)) {
                    this.logger.warn(
                        `[PAYMENT] Apple transaction lookup failed for productId=${requestedProductId}; retrying with receipt verification`,
                    );
                    return this.verifyReceiptWithApple(requestedProductId, input.serverVerificationData, dto);
                }
                throw error;
            }
        }

        if (originalTransactionId) {
            try {
                return await this.verifyOriginalTransactionWithAppStoreServerApi(
                    requestedProductId,
                    originalTransactionId,
                    dto,
                );
            } catch (error) {
                if (this.canFallbackToReceiptVerification(input.serverVerificationData)) {
                    this.logger.warn(
                        `[PAYMENT] Apple original transaction lookup failed for productId=${requestedProductId}; retrying with receipt verification`,
                    );
                    return this.verifyReceiptWithApple(requestedProductId, input.serverVerificationData, dto);
                }
                throw error;
            }
        }

        if (input.serverVerificationData) {
            return this.verifyReceiptWithApple(requestedProductId, input.serverVerificationData, dto);
        }

        return {
            verified: false,
            productId: requestedProductId,
            transactionId: '',
            originalTransactionId: '',
            purchaseDate: new Date(),
            expiryDate: new Date(0),
            subscriptionStatus: SubscriptionStatus.EXPIRED,
            appleStatus: null,
            autoRenewStatus: null,
            environment: 'production',
            raw: { reason: 'missing_apple_verification_data' },
        };
    }

    private async verifyTransactionWithAppStoreServerApi(
        requestedProductId: string,
        transactionId: string,
        dto: VerifyApplePurchaseDto,
    ): Promise<AppleVerificationSnapshot> {
        let lastError: any = null;
        const environments = this.resolveEnvironmentOrder(dto.environment);

        for (const [index, environment] of environments.entries()) {
            try {
                this.logger.log(
                    `[PAYMENT] Apple verify transaction attempt environment=${environment} productId=${requestedProductId} transactionId=${transactionId}`,
                );
                const transactionResponse = await this.callAppStoreServerApi(
                    `/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
                    environment,
                );
                const transactionInfo = this.decodeJwsPayload<AppleTransactionInfo>(
                    transactionResponse.signedTransactionInfo,
                );
                if (!transactionInfo?.originalTransactionId) {
                    throw new BadRequestException('Apple transaction response did not include originalTransactionId.');
                }

                const latest = await this.fetchLatestSubscriptionTransaction(
                    transactionInfo.originalTransactionId,
                    environment,
                    requestedProductId,
                );
                return this.buildServerApiVerificationSnapshot(
                    requestedProductId,
                    latest?.transactionInfo || transactionInfo,
                    latest?.renewalInfo || null,
                    latest?.status ?? null,
                    environment,
                    {
                        transactionResponse,
                        subscriptionResponse: latest?.raw || null,
                    },
                );
            } catch (error: any) {
                lastError = error;
                const hasMoreEnvironments = index < environments.length - 1;
                if (!this.shouldTryNextEnvironment(error, environment, hasMoreEnvironments)) {
                    throw this.toAppleVerificationException(error);
                }

                this.logger.warn(
                    `[PAYMENT] Apple verify transaction fallback environment=${environment} productId=${requestedProductId} transactionId=${transactionId} reason=${this.describeAppleEnvironmentFailure(error)}`,
                );
            }
        }

        throw this.toAppleVerificationException(lastError);
    }

    private async verifyOriginalTransactionWithAppStoreServerApi(
        requestedProductId: string,
        originalTransactionId: string,
        dto: VerifyApplePurchaseDto,
    ): Promise<AppleVerificationSnapshot> {
        let lastError: any = null;
        const environments = this.resolveEnvironmentOrder(dto.environment);

        for (const [index, environment] of environments.entries()) {
            try {
                this.logger.log(
                    `[PAYMENT] Apple verify original transaction attempt environment=${environment} productId=${requestedProductId} originalTransactionId=${originalTransactionId}`,
                );
                const latest = await this.fetchLatestSubscriptionTransaction(
                    originalTransactionId,
                    environment,
                    requestedProductId,
                );
                if (!latest?.transactionInfo) {
                    throw new BadRequestException('No Apple subscription transaction found for originalTransactionId.');
                }

                return this.buildServerApiVerificationSnapshot(
                    requestedProductId,
                    latest.transactionInfo,
                    latest.renewalInfo || null,
                    latest.status ?? null,
                    environment,
                    { subscriptionResponse: latest.raw || null },
                );
            } catch (error: any) {
                lastError = error;
                const hasMoreEnvironments = index < environments.length - 1;
                if (!this.shouldTryNextEnvironment(error, environment, hasMoreEnvironments)) {
                    throw this.toAppleVerificationException(error);
                }

                this.logger.warn(
                    `[PAYMENT] Apple verify original transaction fallback environment=${environment} productId=${requestedProductId} originalTransactionId=${originalTransactionId} reason=${this.describeAppleEnvironmentFailure(error)}`,
                );
            }
        }

        throw this.toAppleVerificationException(lastError);
    }

    private async fetchLatestSubscriptionTransaction(
        originalTransactionId: string,
        environment: AppleEnvironment,
        requestedProductId?: string,
    ): Promise<{
        transactionInfo: AppleTransactionInfo;
        renewalInfo: AppleRenewalInfo | null;
        status: number | null;
        raw: Record<string, any>;
    } | null> {
        const response = await this.callAppStoreServerApi(
            `/inApps/v1/subscriptions/${encodeURIComponent(originalTransactionId)}`,
            environment,
        );
        const candidates: Array<{
            transactionInfo: AppleTransactionInfo;
            renewalInfo: AppleRenewalInfo | null;
            status: number | null;
            raw: Record<string, any>;
        }> = [];

        for (const group of response?.data || []) {
            for (const item of group?.lastTransactions || []) {
                const transactionInfo = this.decodeJwsPayload<AppleTransactionInfo>(
                    item?.signedTransactionInfo,
                );
                if (!transactionInfo?.originalTransactionId) {
                    continue;
                }
                if (transactionInfo.originalTransactionId !== originalTransactionId) {
                    continue;
                }
                if (requestedProductId && transactionInfo.productId !== requestedProductId) {
                    continue;
                }

                candidates.push({
                    transactionInfo,
                    renewalInfo: this.decodeJwsPayload<AppleRenewalInfo>(item?.signedRenewalInfo),
                    status: this.toNullableNumber(item?.status),
                    raw: response,
                });
            }
        }

        if (candidates.length === 0) {
            return null;
        }

        return candidates.sort((a, b) =>
            Number(b.transactionInfo.expiresDate || 0) - Number(a.transactionInfo.expiresDate || 0),
        )[0];
    }

    private buildServerApiVerificationSnapshot(
        requestedProductId: string,
        transactionInfo: AppleTransactionInfo,
        renewalInfo: AppleRenewalInfo | null,
        appleStatus: number | null,
        environment: AppleEnvironment,
        raw: Record<string, any>,
    ): AppleVerificationSnapshot {
        const productId = String(transactionInfo.productId || '').trim();
        const transactionId = String(transactionInfo.transactionId || '').trim();
        const originalTransactionId = String(transactionInfo.originalTransactionId || '').trim();
        const bundleId = String(transactionInfo.bundleId || '').trim();

        if (!productId || !transactionId || !originalTransactionId) {
            throw new BadRequestException('Apple transaction response is missing required identifiers.');
        }
        if (productId !== requestedProductId) {
            throw new BadRequestException('Apple transaction productId does not match request productId.');
        }
        this.assertBundleId(bundleId);

        const purchaseDate = this.parseAppleDate(transactionInfo.purchaseDate) || new Date();
        const expiryDate = this.parseAppleDate(transactionInfo.expiresDate);
        if (!expiryDate) {
            throw new BadRequestException('Apple subscription transaction did not include an expiry date.');
        }

        this.assertTransactionIsUsable(transactionInfo, appleStatus, expiryDate);
        const autoRenewStatus = this.toNullableNumber(renewalInfo?.autoRenewStatus);

        return {
            verified: true,
            productId,
            transactionId,
            originalTransactionId,
            purchaseDate,
            expiryDate,
            subscriptionStatus: this.mapAppleStatusToSubscriptionStatus(appleStatus, autoRenewStatus),
            appleStatus,
            autoRenewStatus,
            environment,
            raw: {
                ...raw,
                decodedTransactionInfo: transactionInfo,
                decodedRenewalInfo: renewalInfo,
            },
        };
    }

    private async verifyReceiptWithApple(
        requestedProductId: string,
        receiptData: string,
        dto: VerifyApplePurchaseDto,
    ): Promise<AppleVerificationSnapshot> {
        const sharedSecret =
            this.configService.get<string>('appleAppStore.sharedSecret') ||
            this.configService.get<string>('APPLE_SHARED_SECRET') ||
            '';

        if (!sharedSecret) {
            throw new ServiceUnavailableException({
                status: 'verification_unavailable',
                error: 'Apple shared secret missing',
                message:
                    'APPLE_SHARED_SECRET is required when iOS sends legacy receipt data instead of transactionId/JWS.',
                retryable: false,
            });
        }

        let lastResponse: Record<string, any> | null = null;
        for (const environment of this.resolveEnvironmentOrder(dto.environment)) {
            this.logger.log(
                `[PAYMENT] Apple verify receipt attempt environment=${environment} productId=${requestedProductId}`,
            );
            const response = await this.callAppleReceiptVerification(receiptData, sharedSecret, environment);
            lastResponse = response;

            const status = Number(response?.status);
            if (status === 21007 && environment === 'production') {
                continue;
            }
            if (status === 21008 && environment === 'sandbox') {
                continue;
            }
            if (status !== 0) {
                throw new BadRequestException({
                    status: 'verification_failed',
                    error: 'Apple receipt verification failed',
                    appleStatus: status,
                });
            }

            return this.buildReceiptVerificationSnapshot(requestedProductId, response, environment);
        }

        throw new BadRequestException({
            status: 'verification_failed',
            error: 'Apple receipt verification failed',
            appleStatus: lastResponse?.status,
        });
    }

    private buildReceiptVerificationSnapshot(
        requestedProductId: string,
        receiptResponse: Record<string, any>,
        environment: AppleEnvironment,
    ): AppleVerificationSnapshot {
        const bundleId = String(receiptResponse?.receipt?.bundle_id || '').trim();
        this.assertBundleId(bundleId);

        const entries = Array.isArray(receiptResponse?.latest_receipt_info)
            ? receiptResponse.latest_receipt_info
            : [];
        const matchingEntries = entries
            .filter((entry) => String(entry?.product_id || '').trim() === requestedProductId)
            .sort((a, b) => Number(b?.expires_date_ms || 0) - Number(a?.expires_date_ms || 0));

        const latest = matchingEntries[0];
        if (!latest) {
            throw new BadRequestException('Apple receipt does not contain the requested productId.');
        }

        const productId = String(latest.product_id || '').trim();
        const transactionId = String(latest.transaction_id || '').trim();
        const originalTransactionId = String(latest.original_transaction_id || '').trim();

        const expiryDate = this.parseAppleDate(latest.expires_date_ms);
        if (!expiryDate) {
            throw new BadRequestException('Apple receipt subscription did not include an expiry date.');
        }
        if (latest.cancellation_date_ms) {
            throw new BadRequestException('Apple receipt transaction was cancelled or refunded.');
        }
        if (expiryDate.getTime() <= Date.now()) {
            throw new BadRequestException('Apple subscription is expired.');
        }

        const pendingRenewal = Array.isArray(receiptResponse?.pending_renewal_info)
            ? receiptResponse.pending_renewal_info.find((info) =>
                String(info?.original_transaction_id || '') === originalTransactionId &&
                String(info?.product_id || requestedProductId) === requestedProductId,
            )
            : null;
        const autoRenewStatus = this.toNullableNumber(pendingRenewal?.auto_renew_status);
        const purchaseDate = this.parseAppleDate(latest.purchase_date_ms) || new Date();

        return {
            verified: true,
            productId,
            transactionId,
            originalTransactionId,
            purchaseDate,
            expiryDate,
            subscriptionStatus: autoRenewStatus === 0
                ? SubscriptionStatus.PENDING_CANCELLATION
                : SubscriptionStatus.ACTIVE,
            appleStatus: null,
            autoRenewStatus,
            environment,
            raw: this.sanitizeReceiptResponse(receiptResponse),
        };
    }

    private async callAppStoreServerApi(path: string, environment: AppleEnvironment): Promise<Record<string, any>> {
        const config = this.getAppleApiConfig();
        const baseUrl = environment === 'sandbox'
            ? 'https://api.storekit-sandbox.itunes.apple.com'
            : 'https://api.storekit.itunes.apple.com';

        const response = await fetch(`${baseUrl}${path}`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${this.createAppStoreJwt(config)}`,
                Accept: 'application/json',
            },
        });
        const body = await this.parseJsonResponse(response);
        if (!response.ok) {
            throw {
                kind: 'apple_api_error',
                status: response.status,
                body,
                environment,
            };
        }

        return body;
    }

    private async callAppleReceiptVerification(
        receiptData: string,
        sharedSecret: string,
        environment: AppleEnvironment,
    ): Promise<Record<string, any>> {
        const url = environment === 'sandbox'
            ? 'https://sandbox.itunes.apple.com/verifyReceipt'
            : 'https://buy.itunes.apple.com/verifyReceipt';
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                'receipt-data': receiptData,
                password: sharedSecret,
                'exclude-old-transactions': false,
            }),
        });

        return this.parseJsonResponse(response);
    }

    private async parseJsonResponse(response: Response): Promise<Record<string, any>> {
        const text = await response.text();
        if (!text) {
            return {};
        }

        try {
            return JSON.parse(text);
        } catch {
            return { raw: text };
        }
    }

    private getAppleApiConfig(): AppleApiConfig {
        const issuerId = this.normalizeConfigValue(
            this.configService.get<string>('appleAppStore.issuerId') ||
            this.configService.get<string>('APPLE_ISSUER_ID'),
        );
        const keyId = this.normalizeConfigValue(
            this.configService.get<string>('appleAppStore.keyId') ||
            this.configService.get<string>('APPLE_KEY_ID'),
        );
        const bundleId = this.normalizeConfigValue(
            this.configService.get<string>('appleAppStore.bundleId') ||
            this.configService.get<string>('APPLE_BUNDLE_ID'),
        );
        const privateKey = this.parsePrivateKey(
            this.configService.get<string>('appleAppStore.privateKey') ||
            this.configService.get<string>('APPLE_PRIVATE_KEY') ||
            '',
        );

        if (!issuerId || !keyId || !bundleId || !privateKey) {
            throw new ServiceUnavailableException({
                status: 'verification_unavailable',
                error: 'Apple App Store Server API credentials missing',
                message:
                    'APPLE_ISSUER_ID, APPLE_KEY_ID, APPLE_BUNDLE_ID, and APPLE_PRIVATE_KEY must be configured.',
                retryable: false,
            });
        }
        if (!privateKey.includes('BEGIN PRIVATE KEY')) {
            throw new ServiceUnavailableException({
                status: 'verification_unavailable',
                error: 'Invalid Apple private key format',
                message: 'APPLE_PRIVATE_KEY must contain the .p8 PEM private key.',
                retryable: false,
            });
        }

        return { issuerId, keyId, bundleId, privateKey };
    }

    private createAppStoreJwt(config: AppleApiConfig): string {
        const now = Math.floor(Date.now() / 1000);
        const header = {
            alg: 'ES256',
            kid: config.keyId,
            typ: 'JWT',
        };
        const payload = {
            iss: config.issuerId,
            iat: now,
            exp: now + 1200,
            aud: 'appstoreconnect-v1',
            bid: config.bundleId,
        };

        const signingInput = `${this.base64UrlJson(header)}.${this.base64UrlJson(payload)}`;
        const signer = createSign('SHA256');
        signer.update(signingInput);
        signer.end();
        const signature = signer.sign({
            key: config.privateKey,
            dsaEncoding: 'ieee-p1363',
        } as any);

        return `${signingInput}.${this.base64Url(signature)}`;
    }

    private resolveVerificationInput(dto: VerifyApplePurchaseDto): {
        transactionId: string;
        originalTransactionId: string;
        serverVerificationData: string;
        source: string;
    } {
        const verificationData = dto.verificationData;
        const nestedServerData = typeof verificationData === 'object'
            ? verificationData?.serverVerificationData || verificationData?.localVerificationData || ''
            : '';
        const directVerificationData = typeof verificationData === 'string' ? verificationData : '';

        const serverVerificationData = this.normalizeConfigValue(
            dto.serverVerificationData ||
            dto.purchaseToken ||
            dto.receiptData ||
            nestedServerData ||
            directVerificationData,
        );

        return {
            transactionId: this.normalizeConfigValue(dto.transactionId),
            originalTransactionId: this.normalizeConfigValue(dto.originalTransactionId),
            serverVerificationData,
            source: dto.serverVerificationData
                ? 'serverVerificationData'
                : dto.purchaseToken
                    ? 'purchaseToken'
                    : dto.receiptData
                        ? 'receiptData'
                        : nestedServerData
                            ? 'verificationData.serverVerificationData'
                            : directVerificationData
                                ? 'verificationData'
                                : 'none',
        };
    }

    private resolveEnvironmentOrder(requestedEnvironment?: string): AppleEnvironment[] {
        const configured = this.normalizeConfigValue(
            requestedEnvironment ||
            this.configService.get<string>('appleAppStore.environment') ||
            this.configService.get<string>('APPLE_APP_STORE_ENVIRONMENT') ||
            'auto',
        ).toLowerCase();

        if (configured === 'sandbox' || configured === 'testflight') {
            return ['sandbox'];
        }
        if (configured === 'production' || configured === 'prod') {
            return ['production'];
        }
        return ['production', 'sandbox'];
    }

    private shouldTryNextEnvironment(
        error: any,
        environment: AppleEnvironment,
        hasMoreEnvironments: boolean,
    ): boolean {
        if (!hasMoreEnvironments) {
            return false;
        }

        const status = Number(error?.status || error?.response?.status || 0);
        const appleErrorCode = String(error?.body?.errorCode || error?.body?.status || '');
        if (status === 404 || appleErrorCode === '21007' || appleErrorCode === '21008') {
            return true;
        }

        return environment === 'production' && (status === 401 || status === 403);
    }

    private toAppleVerificationException(error: any): BadRequestException | ServiceUnavailableException {
        if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) {
            return error;
        }

        const status = Number(error?.status || 0);
        const appleErrorCode = error?.body?.errorCode || error?.body?.status || null;
        const reason = this.resolveAppleFailureReason(status, appleErrorCode);

        const payload = {
            status: reason.retryable ? 'verification_unavailable' : 'verification_failed',
            error: reason.retryable ? 'Verification temporarily unavailable' : 'Invalid or unverified Apple transaction',
            message: reason.message,
            appleStatus: status || null,
            appleErrorCode,
            reason: reason.reason,
            retryable: reason.retryable,
        };

        if (reason.retryable) {
            return new ServiceUnavailableException(payload);
        }

        return new BadRequestException(payload);
    }

    private resolveAppleFailureReason(
        status: number,
        appleErrorCode: unknown,
    ): { reason: string; retryable: boolean; message: string } {
        if (status === 401 || status === 403) {
            return {
                reason: 'apple_api_credentials_or_access',
                retryable: true,
                message: 'Apple verification is unavailable due to App Store Server API credentials or access.',
            };
        }
        if (status === 404) {
            return {
                reason: 'apple_transaction_not_found',
                retryable: false,
                message: 'Apple could not find this transaction in production or sandbox.',
            };
        }
        if (status >= 500) {
            return {
                reason: 'apple_api_unavailable',
                retryable: true,
                message: 'Apple verification is temporarily unavailable. Please retry shortly.',
            };
        }

        return {
            reason: `apple_verification_failed${appleErrorCode ? `_${appleErrorCode}` : ''}`,
            retryable: false,
            message: 'Apple purchase verification failed.',
        };
    }

    private describeAppleEnvironmentFailure(error: any): string {
        const status = Number(error?.status || error?.response?.status || 0);
        const appleErrorCode = error?.body?.errorCode || error?.body?.status || null;
        if (status || appleErrorCode) {
            return `status=${status || 'n/a'} appleCode=${appleErrorCode || 'n/a'}`;
        }
        return error?.message || 'unknown_error';
    }

    private assertTransactionIsUsable(
        transactionInfo: AppleTransactionInfo,
        appleStatus: number | null,
        expiryDate: Date,
    ): void {
        if (transactionInfo.revocationDate) {
            throw new BadRequestException('Apple transaction was refunded or revoked.');
        }
        if (transactionInfo.isUpgraded === true) {
            throw new BadRequestException('Apple transaction was superseded by an upgraded subscription.');
        }
        if (appleStatus === 2) {
            throw new BadRequestException('Apple subscription is expired.');
        }
        if (appleStatus === 5) {
            throw new BadRequestException('Apple subscription was revoked.');
        }
        if (appleStatus !== null && ![1, 4].includes(appleStatus)) {
            throw new BadRequestException('Apple subscription is not active.');
        }
        if (expiryDate.getTime() <= Date.now()) {
            throw new BadRequestException('Apple subscription is expired.');
        }
    }

    private mapAppleStatusToSubscriptionStatus(
        appleStatus: number | null,
        autoRenewStatus: number | null,
    ): SubscriptionStatus {
        if (appleStatus === 4) {
            return SubscriptionStatus.PAST_DUE;
        }
        if (autoRenewStatus === 0) {
            return SubscriptionStatus.PENDING_CANCELLATION;
        }
        return SubscriptionStatus.ACTIVE;
    }

    private async resolveApplePlan(productId: string): Promise<Plan> {
        const byAppleProductId = await this.planRepo.findOne({
            where: { appleProductId: productId, isActive: true },
        });
        if (byAppleProductId) {
            return byAppleProductId;
        }

        const bySharedProductId = await this.planRepo.findOne({
            where: { googleProductId: productId, isActive: true },
        });
        if (bySharedProductId) {
            return bySharedProductId;
        }

        const billingCycle = productId.endsWith('_yearly')
            ? BillingCycle.YEARLY
            : BillingCycle.MONTHLY;
        const plans = await this.planRepo.find({
            where: { billingCycle, isActive: true, isVisible: true },
            order: { sortOrder: 'ASC', price: 'ASC' },
        });
        const paidPlans = plans.filter((plan) =>
            this.normalizePlanToken(plan.code) !== 'free' && Number(plan.price) > 0,
        );

        if (paidPlans.length === 1) {
            return paidPlans[0];
        }

        const premiumPlans = paidPlans.filter((plan) =>
            this.normalizePlanToken(plan.code).includes('premium'),
        );
        if (premiumPlans.length === 1) {
            return premiumPlans[0];
        }

        throw new BadRequestException(
            `No active plan is mapped to Apple productId '${productId}'. Set plans.appleProductId for this product.`,
        );
    }

    private async ensureUserExists(userId: string): Promise<void> {
        const user = await this.userRepo.findOne({ where: { id: userId }, select: ['id'] });
        if (!user) {
            throw new BadRequestException('User not found');
        }
    }

    private async findExistingAppleSubscription(
        userId: string,
        originalTransactionId: string,
        paymentReference: string | null,
    ): Promise<Subscription | null> {
        const where: any[] = [
            { userId, appleOriginalTransactionId: originalTransactionId },
        ];
        if (paymentReference) {
            where.push({ id: paymentReference, userId });
        }

        return this.subscriptionRepo.findOne({
            where,
            relations: ['planEntity'],
            order: { updatedAt: 'DESC' },
        });
    }

    private async cancelCurrentSubscriptions(
        subscriptionRepository: Repository<Subscription>,
        userId: string,
    ): Promise<void> {
        for (const status of [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.PENDING_CANCELLATION,
            SubscriptionStatus.PAST_DUE,
            SubscriptionStatus.TRIAL,
        ]) {
            await subscriptionRepository.update({ userId, status }, { status: SubscriptionStatus.CANCELLED });
        }
    }

    private async recordFailedPurchase(
        userId: string,
        dto: VerifyApplePurchaseDto,
        input: {
            transactionId: string;
            originalTransactionId: string;
            serverVerificationData: string;
            source: string;
        },
        rawVerification: Record<string, any>,
    ): Promise<void> {
        const purchaseToken = input.originalTransactionId || input.transactionId || null;
        const existing = purchaseToken
            ? await this.purchaseRepo.findOne({ where: { purchaseToken } })
            : null;
        const purchase = existing || this.purchaseRepo.create({
            userId,
            planId: null,
            provider: PurchaseProvider.APPLE,
            purchaseToken,
            productId: dto.productId,
            orderId: input.transactionId || null,
            status: PurchaseStatus.FAILED,
            rawVerification: {},
            transactionDate: this.resolveTransactionDate(dto.transactionDate),
            expiryDate: null,
            paymentReference: null,
        });

        purchase.userId = userId;
        purchase.provider = PurchaseProvider.APPLE;
        purchase.purchaseToken = purchaseToken;
        purchase.productId = dto.productId;
        purchase.orderId = input.transactionId || null;
        purchase.status = PurchaseStatus.FAILED;
        purchase.rawVerification = {
            ...(purchase.rawVerification || {}),
            platform: 'ios',
            failedAt: new Date().toISOString(),
            restored: !!dto.restored,
            inputSource: input.source,
            apple: rawVerification || {},
        };

        await this.purchaseRepo.save(purchase);
    }

    private async assertAllowedProduct(productId: string): Promise<void> {
        const normalizedProductId = String(productId || '').trim();
        if (!normalizedProductId) {
            throw new BadRequestException('Apple productId is required');
        }

        const configuredProductIds = await this.planRepo
            .createQueryBuilder('plan')
            .select('plan.appleProductId', 'appleProductId')
            .where('plan.isActive = :isActive', { isActive: true })
            .andWhere('plan.appleProductId IS NOT NULL')
            .andWhere(`TRIM(plan.appleProductId) <> ''`)
            .getRawMany<{ appleProductId: string }>();

        const allowedProductIds = new Set([
            ...this.fallbackAllowedProductIds,
            ...configuredProductIds
                .map((row) => String(row.appleProductId || '').trim())
                .filter((value) => value.length > 0),
        ]);

        if (!allowedProductIds.has(normalizedProductId)) {
            throw new BadRequestException(`Unsupported Apple productId '${productId}'`);
        }
    }

    private assertBundleId(bundleId: string): void {
        const expectedBundleId = this.normalizeConfigValue(
            this.configService.get<string>('appleAppStore.bundleId') ||
            this.configService.get<string>('APPLE_BUNDLE_ID'),
        );
        if (!expectedBundleId) {
            throw new ServiceUnavailableException('APPLE_BUNDLE_ID is required for Apple verification.');
        }
        if (bundleId !== expectedBundleId) {
            throw new BadRequestException('Apple transaction bundleId does not match this app.');
        }
    }

    private resolveTransactionDate(transactionDate?: string): Date {
        const parsed = Number(transactionDate || 0);
        if (Number.isFinite(parsed) && parsed > 0) {
            return new Date(parsed);
        }
        return new Date();
    }

    private parseAppleDate(value: unknown): Date | null {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return null;
        }
        return new Date(parsed);
    }

    private toNullableNumber(value: unknown): number | null {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    private looksLikeTransactionId(value: string): boolean {
        const normalized = String(value || '').trim();
        return /^[0-9]{6,}$/.test(normalized);
    }

    private looksLikeJws(value: string): boolean {
        const normalized = String(value || '').trim();
        const parts = normalized.split('.');
        return parts.length === 3 && parts.every((part) => part.length > 0);
    }

    private canFallbackToReceiptVerification(value: string): boolean {
        const normalized = this.normalizeConfigValue(value);
        if (!normalized) {
            return false;
        }

        return !this.looksLikeTransactionId(normalized) && !this.looksLikeJws(normalized);
    }

    private decodeJwsPayload<T>(jws?: string | null): T | null {
        const normalized = String(jws || '').trim();
        const parts = normalized.split('.');
        if (parts.length < 2) {
            return null;
        }

        try {
            return JSON.parse(this.base64UrlDecode(parts[1]).toString('utf8')) as T;
        } catch {
            return null;
        }
    }

    private base64UrlJson(value: Record<string, any>): string {
        return this.base64Url(Buffer.from(JSON.stringify(value), 'utf8'));
    }

    private base64Url(buffer: Buffer): string {
        return buffer
            .toString('base64')
            .replace(/=/g, '')
            .replace(/\+/g, '-')
            .replace(/\//g, '_');
    }

    private base64UrlDecode(value: string): Buffer {
        const padded = value.replace(/-/g, '+').replace(/_/g, '/');
        const padLength = (4 - (padded.length % 4)) % 4;
        return Buffer.from(`${padded}${'='.repeat(padLength)}`, 'base64');
    }

    private parsePrivateKey(raw: string): string {
        let key = this.normalizeConfigValue(raw);
        key = key.replace(/\\n/g, '\n').trim();
        return key;
    }

    private normalizeConfigValue(value?: string | null): string {
        if (!value) {
            return '';
        }
        return String(value).trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '').trim();
    }

    private sanitizeReceiptResponse(response: Record<string, any>): Record<string, any> {
        const sanitized = { ...response };
        delete sanitized.latest_receipt;
        return sanitized;
    }

    private sameDate(left?: Date | null, right?: Date | null): boolean {
        if (!left || !right) {
            return false;
        }
        return new Date(left).getTime() === new Date(right).getTime();
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
            appleProductId: plan.appleProductId,
        };
    }

    private serializeSubscription(subscription: Subscription) {
        return {
            id: subscription.id,
            status: subscription.status,
            startDate: subscription.startDate,
            endDate: subscription.endDate,
            paymentProvider: subscription.paymentProvider,
            paymentPlatform: subscription.paymentPlatform,
            appleProductId: subscription.appleProductId,
            appleTransactionId: subscription.appleTransactionId,
            appleOriginalTransactionId: subscription.appleOriginalTransactionId,
            appleEnvironment: subscription.appleEnvironment,
        };
    }

    private normalizePlanToken(value?: string | null): string {
        return (value ?? '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
    }
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseCompatibilityService implements OnModuleInit {
    private readonly logger = new Logger(DatabaseCompatibilityService.name);

    constructor(@InjectDataSource() private readonly dataSource: DataSource) { }

    async onModuleInit() {
        await this.ensureCompatibility();
    }

    private async ensureCompatibility() {
        if (!this.dataSource.isInitialized || this.dataSource.options.type !== 'postgres') {
            return;
        }

        const enumStatements = [
            {
                label: 'users_status_enum.limited',
                sql: `DO $$ BEGIN
                    ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS 'limited';
                EXCEPTION
                    WHEN undefined_object THEN NULL;
                END $$;`,
            },
            {
                label: 'users_status_enum.shadow_suspended',
                sql: `DO $$ BEGIN
                    ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS 'shadow_suspended';
                EXCEPTION
                    WHEN undefined_object THEN NULL;
                END $$;`,
            },
            {
                label: 'users_status_enum.deactivated',
                sql: `DO $$ BEGIN
                    ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS 'deactivated';
                EXCEPTION
                    WHEN undefined_object THEN NULL;
                END $$;`,
            },
            {
                label: 'users_status_enum.closed',
                sql: `DO $$ BEGIN
                    ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS 'closed';
                EXCEPTION
                    WHEN undefined_object THEN NULL;
                END $$;`,
            },
            {
                label: 'users_status_enum.pending_verification',
                sql: `DO $$ BEGIN
                    ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS 'pending_verification';
                EXCEPTION
                    WHEN undefined_object THEN NULL;
                END $$;`,
            },
            {
                label: 'users_status_enum.rejected',
                sql: `DO $$ BEGIN
                    ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS 'rejected';
                EXCEPTION
                    WHEN undefined_object THEN NULL;
                END $$;`,
            },
            {
                label: 'users_role_enum.moderator',
                sql: `DO $$ BEGIN
                    ALTER TYPE "users_role_enum" ADD VALUE IF NOT EXISTS 'moderator';
                EXCEPTION
                    WHEN undefined_object THEN NULL;
                END $$;`,
            },
            {
                label: 'notifications_type_enum.ticket',
                sql: `DO $$ BEGIN
                    ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'ticket';
                EXCEPTION
                    WHEN undefined_object THEN NULL;
                END $$;`,
            },
            {
                label: 'subscriptions_status_enum.pending_cancellation',
                sql: `DO $$ BEGIN
                    ALTER TYPE "subscriptions_status_enum" ADD VALUE IF NOT EXISTS 'pending_cancellation';
                EXCEPTION
                    WHEN undefined_object THEN NULL;
                END $$;`,
            },
            {
                label: 'subscriptions_status_enum.past_due',
                sql: `DO $$ BEGIN
                    ALTER TYPE "subscriptions_status_enum" ADD VALUE IF NOT EXISTS 'past_due';
                EXCEPTION
                    WHEN undefined_object THEN NULL;
                END $$;`,
            },
            {
                label: 'subscriptions_status_enum.trial',
                sql: `DO $$ BEGIN
                    ALTER TYPE "subscriptions_status_enum" ADD VALUE IF NOT EXISTS 'trial';
                EXCEPTION
                    WHEN undefined_object THEN NULL;
                END $$;`,
            },
        ];

        const tableStatements = [
            {
                label: 'analytics_events table',
                sql: `CREATE TABLE IF NOT EXISTS "analytics_events" (
                    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                    "eventType" character varying NOT NULL,
                    "userId" character varying NULL,
                    "metadata" jsonb NULL,
                    "eventDate" date NOT NULL DEFAULT CURRENT_DATE,
                    "createdAt" timestamp NOT NULL DEFAULT now()
                )`,
            },
            {
                label: 'consumable_products table',
                sql: `CREATE TABLE IF NOT EXISTS "consumable_products" (
                    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                    "code" character varying NOT NULL UNIQUE,
                    "title" character varying NOT NULL,
                    "description" text NULL,
                    "type" character varying NOT NULL,
                    "quantity" integer NOT NULL DEFAULT 0,
                    "price" decimal(10, 2) NOT NULL DEFAULT 0,
                    "currency" character varying NOT NULL DEFAULT 'usd',
                    "isActive" boolean NOT NULL DEFAULT true,
                    "isArchived" boolean NOT NULL DEFAULT false,
                    "platformAvailability" character varying NOT NULL DEFAULT 'all',
                    "sortOrder" integer NOT NULL DEFAULT 0,
                    "googleProductId" character varying NULL,
                    "stripePriceId" character varying NULL,
                    "stripeProductId" character varying NULL,
                    "createdAt" timestamp NOT NULL DEFAULT now(),
                    "updatedAt" timestamp NOT NULL DEFAULT now()
                )`,
            },
            {
                label: 'purchase_transactions table',
                sql: `CREATE TABLE IF NOT EXISTS "purchase_transactions" (
                    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                    "userId" uuid NOT NULL,
                    "planId" uuid NULL,
                    "consumableProductId" uuid NULL,
                    "provider" character varying NOT NULL,
                    "purchaseToken" character varying NULL,
                    "productId" character varying NULL,
                    "orderId" character varying NULL,
                    "status" character varying NOT NULL DEFAULT 'pending',
                    "rawVerification" jsonb NOT NULL DEFAULT '{}'::jsonb,
                    "transactionDate" timestamp NULL,
                    "expiryDate" timestamp NULL,
                    "paymentReference" character varying NULL,
                    "createdAt" timestamp NOT NULL DEFAULT now(),
                    "updatedAt" timestamp NOT NULL DEFAULT now()
                )`,
            },
        ];

        const columnStatements = [
            { label: 'users.statusReason', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "statusReason" text' },
            { label: 'users.moderationReasonCode', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "moderationReasonCode" character varying' },
            { label: 'users.moderationReasonText', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "moderationReasonText" text' },
            { label: 'users.actionRequired', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "actionRequired" character varying' },
            { label: 'users.supportMessage', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "supportMessage" text' },
            { label: 'users.isUserVisible', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isUserVisible" boolean DEFAULT true' },
            { label: 'users.moderationExpiresAt', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "moderationExpiresAt" timestamptz' },
            { label: 'users.internalAdminNote', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "internalAdminNote" text' },
            { label: 'users.updatedByAdminId', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "updatedByAdminId" character varying' },
            { label: 'users.readReceipts', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "readReceipts" boolean DEFAULT true' },
            { label: 'users.typingIndicator', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "typingIndicator" boolean DEFAULT true' },
            { label: 'users.autoDownloadMedia', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "autoDownloadMedia" boolean DEFAULT true' },
            { label: 'users.receiveDMs', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "receiveDMs" boolean DEFAULT true' },
            { label: 'users.locationEnabled', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locationEnabled" boolean DEFAULT false' },
            { label: 'users.isPremium', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isPremium" boolean DEFAULT false' },
            { label: 'users.premiumStartDate', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "premiumStartDate" timestamptz' },
            { label: 'users.premiumExpiryDate', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "premiumExpiryDate" timestamptz' },
            { label: 'users.subscriptionPlanId', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscriptionPlanId" character varying' },
            { label: 'users.isGhostModeEnabled', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isGhostModeEnabled" boolean DEFAULT false' },
            { label: 'users.isPassportActive', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isPassportActive" boolean DEFAULT false' },
            { label: 'users.realLocation', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "realLocation" jsonb' },
            { label: 'users.passportLocation', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passportLocation" jsonb' },
            { label: 'users.verification', sql: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "verification" jsonb DEFAULT '{}'::jsonb` },
            { label: 'users.backgroundCheckStatus', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "backgroundCheckStatus" character varying' },
            { label: 'users.backgroundCheckCheckId', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "backgroundCheckCheckId" character varying' },
            { label: 'users.backgroundCheckCompletedAt', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "backgroundCheckCompletedAt" timestamptz' },
            { label: 'users.likesBalance', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "likesBalance" integer DEFAULT 0' },
            { label: 'users.complimentsBalance', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "complimentsBalance" integer DEFAULT 0' },
            { label: 'users.boostsBalance', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "boostsBalance" integer DEFAULT 0' },
            { label: 'subscriptions.planId', sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "planId" character varying' },
            { label: 'subscriptions.plan', sql: `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "plan" character varying DEFAULT 'free'` },
            { label: 'subscriptions.status', sql: `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "status" character varying DEFAULT 'active'` },
            { label: 'subscriptions.startDate', sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "startDate" timestamp' },
            { label: 'subscriptions.endDate', sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "endDate" timestamp' },
            { label: 'subscriptions.paymentReference', sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "paymentReference" character varying' },
            { label: 'subscriptions.paymentProvider', sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "paymentProvider" character varying' },
            { label: 'subscriptions.googleProductId', sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "googleProductId" character varying' },
            { label: 'subscriptions.googlePurchaseToken', sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "googlePurchaseToken" character varying' },
            { label: 'subscriptions.googleOrderId', sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "googleOrderId" character varying' },
            { label: 'subscriptions.stripeSubscriptionId', sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" character varying' },
            { label: 'subscriptions.stripeCheckoutSessionId', sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "stripeCheckoutSessionId" character varying' },
            { label: 'subscriptions.stripeCustomerId', sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "stripeCustomerId" character varying' },
            { label: 'subscriptions.billingCycle', sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "billingCycle" character varying' },
            { label: 'subscriptions.createdAt', sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now()' },
            { label: 'subscriptions.updatedAt', sql: 'ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now()' },
            { label: 'plans.code', sql: 'ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "code" character varying' },
            { label: 'plans.name', sql: `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "name" character varying DEFAULT 'Plan'` },
            { label: 'plans.description', sql: 'ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "description" text' },
            { label: 'plans.price', sql: 'ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "price" decimal(10,2) DEFAULT 0' },
            { label: 'plans.currency', sql: `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "currency" character varying DEFAULT 'usd'` },
            { label: 'plans.billingCycle', sql: `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "billingCycle" character varying DEFAULT 'monthly'` },
            { label: 'plans.stripePriceId', sql: 'ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "stripePriceId" character varying' },
            { label: 'plans.stripeProductId', sql: 'ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "stripeProductId" character varying' },
            { label: 'plans.googleProductId', sql: 'ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "googleProductId" character varying' },
            { label: 'plans.googleBasePlanId', sql: 'ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "googleBasePlanId" character varying' },
            { label: 'plans.durationDays', sql: 'ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "durationDays" integer DEFAULT 30' },
            { label: 'plans.isActive', sql: 'ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "isActive" boolean DEFAULT true' },
            { label: 'plans.isVisible', sql: 'ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "isVisible" boolean DEFAULT true' },
            { label: 'plans.sortOrder', sql: 'ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "sortOrder" integer DEFAULT 0' },
            { label: 'plans.entitlements', sql: `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "entitlements" jsonb DEFAULT '{}'::jsonb` },
            { label: 'plans.featureFlags', sql: `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "featureFlags" jsonb DEFAULT '{}'::jsonb` },
            { label: 'plans.limits', sql: `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "limits" jsonb DEFAULT '{}'::jsonb` },
            { label: 'plans.features', sql: `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "features" jsonb DEFAULT '[]'::jsonb` },
            { label: 'plans.dailyLikesLimit', sql: 'ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "dailyLikesLimit" integer DEFAULT 10' },
            { label: 'plans.dailySuperLikesLimit', sql: 'ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "dailySuperLikesLimit" integer DEFAULT 0' },
            { label: 'plans.dailyComplimentsLimit', sql: 'ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "dailyComplimentsLimit" integer DEFAULT 0' },
            { label: 'plans.monthlyRewindsLimit', sql: 'ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "monthlyRewindsLimit" integer DEFAULT 2' },
            { label: 'plans.weeklyBoostsLimit', sql: 'ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "weeklyBoostsLimit" integer DEFAULT 0' },
            { label: 'plans.createdAt', sql: 'ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now()' },
            { label: 'plans.updatedAt', sql: 'ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now()' },
            { label: 'conversations.user1Id', sql: 'ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "user1Id" character varying' },
            { label: 'conversations.user2Id', sql: 'ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "user2Id" character varying' },
            { label: 'conversations.matchId', sql: 'ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "matchId" character varying' },
            { label: 'conversations.lastMessageContent', sql: 'ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "lastMessageContent" character varying' },
            { label: 'conversations.lastMessageAt', sql: 'ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "lastMessageAt" timestamp' },
            { label: 'conversations.lastMessageSenderId', sql: 'ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "lastMessageSenderId" character varying' },
            { label: 'conversations.user1UnreadCount', sql: 'ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "user1UnreadCount" integer DEFAULT 0' },
            { label: 'conversations.user2UnreadCount', sql: 'ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "user2UnreadCount" integer DEFAULT 0' },
            { label: 'conversations.user1Muted', sql: 'ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "user1Muted" boolean DEFAULT false' },
            { label: 'conversations.user2Muted', sql: 'ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "user2Muted" boolean DEFAULT false' },
            { label: 'conversations.isActive', sql: 'ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "isActive" boolean DEFAULT true' },
            { label: 'conversations.isLocked', sql: 'ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "isLocked" boolean DEFAULT false' },
            { label: 'conversations.lockReason', sql: 'ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "lockReason" character varying' },
            { label: 'conversations.isFlagged', sql: 'ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "isFlagged" boolean DEFAULT false' },
            { label: 'conversations.flagReason', sql: 'ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "flagReason" character varying' },
            { label: 'conversations.createdAt', sql: 'ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now()' },
            { label: 'conversations.updatedAt', sql: 'ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now()' },
            { label: 'messages.conversationId', sql: 'ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "conversationId" character varying' },
            { label: 'messages.matchId', sql: 'ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "matchId" character varying' },
            { label: 'messages.senderId', sql: 'ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "senderId" character varying' },
            { label: 'messages.content', sql: `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "content" text DEFAULT ''` },
            { label: 'messages.type', sql: `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "type" character varying DEFAULT 'text'` },
            { label: 'messages.status', sql: `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "status" character varying DEFAULT 'sent'` },
            { label: 'messages.deliveredAt', sql: 'ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "deliveredAt" timestamp' },
            { label: 'messages.readAt', sql: 'ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "readAt" timestamp' },
            { label: 'messages.createdAt', sql: 'ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now()' },
            { label: 'analytics_events.eventType', sql: 'ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "eventType" character varying' },
            { label: 'analytics_events.userId', sql: 'ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "userId" character varying' },
            { label: 'analytics_events.metadata', sql: 'ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "metadata" jsonb' },
            { label: 'analytics_events.eventDate', sql: 'ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "eventDate" date DEFAULT CURRENT_DATE' },
            { label: 'analytics_events.createdAt', sql: 'ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now()' },
            { label: 'consumable_products.code', sql: 'ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "code" character varying' },
            { label: 'consumable_products.title', sql: 'ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "title" character varying' },
            { label: 'consumable_products.description', sql: 'ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "description" text' },
            { label: 'consumable_products.type', sql: 'ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "type" character varying' },
            { label: 'consumable_products.quantity', sql: 'ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "quantity" integer DEFAULT 0' },
            { label: 'consumable_products.price', sql: 'ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "price" decimal(10, 2) DEFAULT 0' },
            { label: 'consumable_products.currency', sql: `ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "currency" character varying DEFAULT 'usd'` },
            { label: 'consumable_products.isActive', sql: 'ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "isActive" boolean DEFAULT true' },
            { label: 'consumable_products.isArchived', sql: 'ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "isArchived" boolean DEFAULT false' },
            { label: 'consumable_products.platformAvailability', sql: `ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "platformAvailability" character varying DEFAULT 'all'` },
            { label: 'consumable_products.sortOrder', sql: 'ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "sortOrder" integer DEFAULT 0' },
            { label: 'consumable_products.googleProductId', sql: 'ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "googleProductId" character varying' },
            { label: 'consumable_products.stripePriceId', sql: 'ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "stripePriceId" character varying' },
            { label: 'consumable_products.stripeProductId', sql: 'ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "stripeProductId" character varying' },
            { label: 'consumable_products.createdAt', sql: 'ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now()' },
            { label: 'consumable_products.updatedAt', sql: 'ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now()' },
            { label: 'purchase_transactions.consumableProductId', sql: 'ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "consumableProductId" uuid' },
            { label: 'purchase_transactions.provider', sql: 'ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "provider" character varying' },
            { label: 'purchase_transactions.purchaseToken', sql: 'ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "purchaseToken" character varying' },
            { label: 'purchase_transactions.productId', sql: 'ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "productId" character varying' },
            { label: 'purchase_transactions.orderId', sql: 'ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "orderId" character varying' },
            { label: 'purchase_transactions.status', sql: `ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "status" character varying DEFAULT 'pending'` },
            { label: 'purchase_transactions.rawVerification', sql: `ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "rawVerification" jsonb DEFAULT '{}'::jsonb` },
            { label: 'purchase_transactions.transactionDate', sql: 'ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "transactionDate" timestamp' },
            { label: 'purchase_transactions.expiryDate', sql: 'ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "expiryDate" timestamp' },
            { label: 'purchase_transactions.paymentReference', sql: 'ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "paymentReference" character varying' },
            { label: 'purchase_transactions.createdAt', sql: 'ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now()' },
            { label: 'purchase_transactions.updatedAt', sql: 'ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now()' },
            { label: 'likes.type', sql: `ALTER TABLE "likes" ADD COLUMN IF NOT EXISTS "type" character varying DEFAULT 'like'` },
            { label: 'likes.isLike', sql: 'ALTER TABLE "likes" ADD COLUMN IF NOT EXISTS "isLike" boolean DEFAULT true' },
            { label: 'likes.complimentMessage', sql: 'ALTER TABLE "likes" ADD COLUMN IF NOT EXISTS "complimentMessage" character varying(500)' },
            { label: 'matches.matchedAt', sql: 'ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "matchedAt" timestamp DEFAULT now()' },
            { label: 'matches.status', sql: `ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "status" character varying DEFAULT 'active'` },
            { label: 'reports.status', sql: `ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "status" character varying DEFAULT 'pending'` },
            { label: 'reports.moderatorNote', sql: 'ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "moderatorNote" character varying' },
            { label: 'reports.resolvedById', sql: 'ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "resolvedById" character varying' },
            { label: 'photos.moderationStatus', sql: `ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "moderationStatus" character varying DEFAULT 'approved'` },
            { label: 'photos.moderationNote', sql: 'ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "moderationNote" character varying' },
            { label: 'boosts.isActive', sql: 'ALTER TABLE "boosts" ADD COLUMN IF NOT EXISTS "isActive" boolean DEFAULT true' },
            { label: 'boosts.type', sql: `ALTER TABLE "boosts" ADD COLUMN IF NOT EXISTS "type" character varying DEFAULT 'paid'` },
            { label: 'boosts.profileViewsGained', sql: 'ALTER TABLE "boosts" ADD COLUMN IF NOT EXISTS "profileViewsGained" integer DEFAULT 0' },
            { label: 'ads.targetGender', sql: 'ALTER TABLE "ads" ADD COLUMN IF NOT EXISTS "targetGender" character varying' },
            { label: 'ads.targetPlan', sql: 'ALTER TABLE "ads" ADD COLUMN IF NOT EXISTS "targetPlan" character varying' },
            { label: 'ads.targetCountry', sql: 'ALTER TABLE "ads" ADD COLUMN IF NOT EXISTS "targetCountry" character varying' },
            { label: 'ads.targetCity', sql: 'ALTER TABLE "ads" ADD COLUMN IF NOT EXISTS "targetCity" character varying' },
            { label: 'ads.showEveryNUsers', sql: 'ALTER TABLE "ads" ADD COLUMN IF NOT EXISTS "showEveryNUsers" integer DEFAULT 1' },
            { label: 'ads.weight', sql: 'ALTER TABLE "ads" ADD COLUMN IF NOT EXISTS "weight" integer DEFAULT 1' },
        ];

        for (const statement of [...enumStatements, ...tableStatements, ...columnStatements]) {
            await this.runStatement(statement.label, statement.sql);
        }

        await this.runStatement(
            'plans.code backfill',
            `WITH normalized AS (
                 SELECT
                     p.id,
                     LOWER(
                         REGEXP_REPLACE(
                             COALESCE(NULLIF(BTRIM(p."code"), ''), NULLIF(BTRIM(p.name), ''), 'plan'),
                             '[^a-zA-Z0-9]+',
                             '_',
                             'g'
                         )
                     ) AS base_code
                 FROM "plans" p
                 WHERE p."code" IS NULL OR BTRIM(p."code") = ''
             ),
             ranked AS (
                 SELECT
                     n.id,
                     n.base_code,
                     ROW_NUMBER() OVER (PARTITION BY n.base_code ORDER BY n.id) AS rn
                 FROM normalized n
             )
             UPDATE "plans" p
             SET "code" = CASE
                 WHEN r.rn = 1 THEN r.base_code
                 ELSE r.base_code || '_' || r.rn
             END
             FROM ranked r
             WHERE p.id = r.id`,
        );

        await this.runStatement(
            'users.subscriptionPlanId index',
            `CREATE INDEX IF NOT EXISTS "IDX_users_subscriptionPlanId"
             ON "users" ("subscriptionPlanId")`,
        );

        await this.runStatement(
            'users.isGhostModeEnabled index',
            `CREATE INDEX IF NOT EXISTS "IDX_users_isGhostModeEnabled"
             ON "users" ("isGhostModeEnabled")`,
        );

        await this.runStatement(
            'users.isPassportActive index',
            `CREATE INDEX IF NOT EXISTS "IDX_users_isPassportActive"
             ON "users" ("isPassportActive")`,
        );

        await this.runStatement(
            'plans.code unique index',
            `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_plans_code_unique"
             ON "plans" ("code")
             WHERE "code" IS NOT NULL`,
        );

        await this.runStatement(
            'subscriptions.googlePurchaseToken index',
            `CREATE INDEX IF NOT EXISTS "IDX_subscriptions_googlePurchaseToken"
             ON "subscriptions" ("googlePurchaseToken")`,
        );

        await this.runStatement(
            'subscriptions.stripeCustomerId index',
            `CREATE INDEX IF NOT EXISTS "IDX_subscriptions_stripeCustomerId"
             ON "subscriptions" ("stripeCustomerId")`,
        );

        await this.runStatement(
            'plans.googleProductId index',
            `CREATE INDEX IF NOT EXISTS "IDX_plans_googleProductId"
             ON "plans" ("googleProductId")`,
        );

        await this.runStatement(
            'plans.googleBasePlanId index',
            `CREATE INDEX IF NOT EXISTS "IDX_plans_googleBasePlanId"
             ON "plans" ("googleBasePlanId")`,
        );

        await this.runStatement(
            'analytics_events type/date index',
            `CREATE INDEX IF NOT EXISTS "IDX_analytics_type_date"
             ON "analytics_events" ("eventType", "eventDate")`,
        );

        await this.runStatement(
            'analytics_events user/date index',
            `CREATE INDEX IF NOT EXISTS "IDX_analytics_user_date"
             ON "analytics_events" ("userId", "eventDate")`,
        );

        await this.runStatement(
            'consumable_products code index',
            `CREATE INDEX IF NOT EXISTS "IDX_consumable_products_code"
             ON "consumable_products" ("code")`,
        );

        await this.runStatement(
            'consumable_products googleProductId index',
            `CREATE INDEX IF NOT EXISTS "IDX_consumable_products_googleProductId"
             ON "consumable_products" ("googleProductId")
             WHERE "googleProductId" IS NOT NULL`,
        );

        await this.runStatement(
            'consumable_products stripePriceId index',
            `CREATE INDEX IF NOT EXISTS "IDX_consumable_products_stripePriceId"
             ON "consumable_products" ("stripePriceId")
             WHERE "stripePriceId" IS NOT NULL`,
        );

        await this.runStatement(
            'purchase_transactions consumableProductId index',
            `CREATE INDEX IF NOT EXISTS "IDX_purchase_transactions_consumableProductId"
             ON "purchase_transactions" ("consumableProductId")`,
        );

        await this.runStatement(
            'purchase_transactions purchaseToken unique index',
            `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_purchase_transactions_purchaseToken"
             ON "purchase_transactions" ("purchaseToken")
             WHERE "purchaseToken" IS NOT NULL`,
        );

        await this.runStatement(
            'users.verification backfill',
            `UPDATE "users"
             SET "verification" = jsonb_build_object(
                 'selfie',
                 jsonb_build_object(
                     'status',
                     CASE
                         WHEN "selfieVerified" = true THEN 'approved'
                         WHEN "selfieUrl" IS NOT NULL THEN 'pending'
                         ELSE 'not_uploaded'
                     END,
                     'url', "selfieUrl",
                     'rejectionReason', NULL,
                     'submittedAt', NULL,
                     'reviewedAt', NULL,
                     'reviewedBy', NULL
                 ),
                 'marital_status',
                 jsonb_build_object(
                     'status', 'not_uploaded',
                     'url', NULL,
                     'rejectionReason', NULL,
                     'submittedAt', NULL,
                     'reviewedAt', NULL,
                     'reviewedBy', NULL
                 )
             )
             WHERE "verification" IS NULL OR "verification" = '{}'::jsonb`,
        );

        await this.runStatement(
            'users premium backfill from subscriptions',
            `WITH latest_active_premium AS (
                SELECT DISTINCT ON ("userId")
                    "userId",
                    "startDate",
                    "endDate"
                FROM "subscriptions"
                WHERE status = 'active'
                  AND plan <> 'free'
                  AND ("endDate" IS NULL OR "endDate" > NOW())
                ORDER BY "userId", "endDate" DESC NULLS LAST, "createdAt" DESC
            )
            UPDATE "users" AS u
            SET
                "isPremium" = CASE
                    WHEN s."startDate" IS NULL OR s."startDate" <= NOW() THEN true
                    ELSE false
                END,
                "premiumStartDate" = s."startDate",
                "premiumExpiryDate" = s."endDate"
            FROM latest_active_premium AS s
            WHERE u.id = s."userId"`,
        );

        await this.runStatement(
            'users non-premium reset',
            `UPDATE "users"
             SET
                 "isPremium" = false,
                 "premiumStartDate" = NULL,
                 "premiumExpiryDate" = NULL
             WHERE id NOT IN (
                 SELECT DISTINCT "userId"
                 FROM "subscriptions"
                 WHERE status = 'active'
                   AND plan <> 'free'
                   AND ("endDate" IS NULL OR "endDate" > NOW())
             )`,
        );

        this.logger.log('Database compatibility sync completed');
    }

    private async runStatement(label: string, sql: string) {
        try {
            await this.dataSource.query(sql);
        } catch (error: any) {
            this.logger.warn(`${label} skipped: ${error?.message ?? error}`);
        }
    }
}


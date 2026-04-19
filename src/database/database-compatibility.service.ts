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
            { label: 'users.verification', sql: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "verification" jsonb DEFAULT '{}'::jsonb` },
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
        ];

        for (const statement of [...enumStatements, ...columnStatements]) {
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


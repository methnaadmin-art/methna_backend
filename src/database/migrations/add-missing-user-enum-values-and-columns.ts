import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMissingUserEnumValuesAndColumns1715000000000 implements MigrationInterface {
    name = 'AddMissingUserEnumValuesAndColumns1715000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // ─── UserStatus enum: add missing values ──────────────
        await queryRunner.query(`ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS 'limited'`);
        await queryRunner.query(`ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS 'shadow_suspended'`);
        await queryRunner.query(`ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS 'deactivated'`);
        await queryRunner.query(`ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS 'closed'`);
        await queryRunner.query(`ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS 'pending_verification'`);

        // ─── UserRole enum: add missing values ────────────────
        await queryRunner.query(`ALTER TYPE "users_role_enum" ADD VALUE IF NOT EXISTS 'moderator'`);

        // ─── Users: add missing columns ───────────────────────
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "statusReason" text NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "moderationReasonCode" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "moderationReasonText" text NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "actionRequired" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "supportMessage" text NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isUserVisible" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "moderationExpiresAt" timestamptz NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "internalAdminNote" text NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "updatedByAdminId" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isPremium" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "premiumStartDate" timestamptz NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "premiumExpiryDate" timestamptz NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "verification" jsonb NULL DEFAULT '{}'`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailVerified" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "selfieVerified" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "selfieUrl" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "documentUrl" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "documentType" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "documentVerified" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "documentVerifiedAt" timestamptz NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "documentRejectionReason" text NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "fcmToken" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notificationsEnabled" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "matchNotifications" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "messageNotifications" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "likeNotifications" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "profileVisitorNotifications" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "eventsNotifications" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "safetyAlertNotifications" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "promotionsNotifications" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "inAppRecommendationNotifications" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "weeklySummaryNotifications" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "connectionRequestNotifications" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "surveyNotifications" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "readReceipts" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "typingIndicator" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "autoDownloadMedia" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "receiveDMs" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locationEnabled" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "boostedUntil" timestamptz NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isShadowBanned" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "trustScore" float NOT NULL DEFAULT 100`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "flagCount" integer NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastKnownIp" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deviceCount" integer NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastLoginAt" timestamptz NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripeCustomerId" character varying NULL`);

        // ─── Conversations: add missing columns ───────────────
        await queryRunner.query(`ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "isFlagged" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "flagReason" character varying NULL`);

        // ─── Ads: add missing columns ─────────────────────────
        await queryRunner.query(`ALTER TABLE "ads" ADD COLUMN IF NOT EXISTS "targetCountry" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "ads" ADD COLUMN IF NOT EXISTS "targetCity" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "ads" ADD COLUMN IF NOT EXISTS "showEveryNUsers" integer NOT NULL DEFAULT 1`);

        // ─── Plans table: create if not exists, then add any missing columns ──
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "plans" (
                "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
                "code" character varying NOT NULL UNIQUE,
                "name" character varying NOT NULL,
                "createdAt" timestamptz NOT NULL DEFAULT now(),
                "updatedAt" timestamptz NOT NULL DEFAULT now()
            )
        `);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "description" text NULL`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "price" decimal(10,2) NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "currency" character varying NOT NULL DEFAULT 'usd'`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "billingCycle" character varying NOT NULL DEFAULT 'monthly'`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "stripePriceId" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "durationDays" integer NOT NULL DEFAULT 30`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "isActive" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "isVisible" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "sortOrder" integer NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "entitlements" jsonb NOT NULL DEFAULT '{}'`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "features" jsonb NOT NULL DEFAULT '[]'`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "dailyLikesLimit" integer NOT NULL DEFAULT 10`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "dailySuperLikesLimit" integer NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "dailyComplimentsLimit" integer NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "monthlyRewindsLimit" integer NOT NULL DEFAULT 2`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "weeklyBoostsLimit" integer NOT NULL DEFAULT 0`);

        // ─── Subscriptions: add missing columns ──────────────
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "planId" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "stripeCheckoutSessionId" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "stripeCustomerId" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "billingCycle" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "paymentReference" character varying NULL`);

        // ─── ModerationReasonCode enum (create if not exists) ─
        // TypeORM creates this as a PG enum. We need to ensure it exists.
        // Since we can't easily check if an enum type exists in a migration,
        // we'll handle it by making the column varchar instead and letting
        // synchronize convert it to enum later.
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // No-op for safety — removing columns in production is dangerous
    }
}

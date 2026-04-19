import { MigrationInterface, QueryRunner } from 'typeorm';

export class RepairSubscriptionPlanColumnsRuntimeDrift1776646800000 implements MigrationInterface {
    name = 'RepairSubscriptionPlanColumnsRuntimeDrift1776646800000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DO $$ BEGIN
            ALTER TYPE "subscriptions_status_enum" ADD VALUE IF NOT EXISTS 'pending_cancellation';
        EXCEPTION
            WHEN undefined_object THEN NULL;
        END $$;`);
        await queryRunner.query(`DO $$ BEGIN
            ALTER TYPE "subscriptions_status_enum" ADD VALUE IF NOT EXISTS 'past_due';
        EXCEPTION
            WHEN undefined_object THEN NULL;
        END $$;`);
        await queryRunner.query(`DO $$ BEGIN
            ALTER TYPE "subscriptions_status_enum" ADD VALUE IF NOT EXISTS 'trial';
        EXCEPTION
            WHEN undefined_object THEN NULL;
        END $$;`);

        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "planId" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "plan" character varying NOT NULL DEFAULT 'free'`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "status" character varying NOT NULL DEFAULT 'active'`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "startDate" timestamp NULL`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "endDate" timestamp NULL`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "paymentReference" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "paymentProvider" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "googleProductId" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "googlePurchaseToken" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "googleOrderId" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "stripeCheckoutSessionId" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "stripeCustomerId" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "billingCycle" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "createdAt" timestamp NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp NOT NULL DEFAULT now()`);

        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "code" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "name" character varying NOT NULL DEFAULT 'Plan'`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "description" text NULL`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "price" decimal(10,2) NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "currency" character varying NOT NULL DEFAULT 'usd'`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "billingCycle" character varying NOT NULL DEFAULT 'monthly'`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "stripePriceId" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "stripeProductId" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "googleProductId" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "googleBasePlanId" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "durationDays" integer NOT NULL DEFAULT 30`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "isActive" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "isVisible" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "sortOrder" integer NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "entitlements" jsonb NOT NULL DEFAULT '{}'::jsonb`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "featureFlags" jsonb NOT NULL DEFAULT '{}'::jsonb`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "limits" jsonb NOT NULL DEFAULT '{}'::jsonb`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "features" jsonb NOT NULL DEFAULT '[]'::jsonb`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "dailyLikesLimit" integer NOT NULL DEFAULT 10`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "dailySuperLikesLimit" integer NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "dailyComplimentsLimit" integer NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "monthlyRewindsLimit" integer NOT NULL DEFAULT 2`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "weeklyBoostsLimit" integer NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "createdAt" timestamp NOT NULL DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp NOT NULL DEFAULT now()`);

        await queryRunner.query(`
            WITH normalized AS (
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
            WHERE p.id = r.id
        `);

        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_plans_code_unique" ON "plans" ("code") WHERE "code" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_subscriptions_googlePurchaseToken" ON "subscriptions" ("googlePurchaseToken")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_subscriptions_stripeCustomerId" ON "subscriptions" ("stripeCustomerId")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_plans_googleProductId" ON "plans" ("googleProductId")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_plans_googleBasePlanId" ON "plans" ("googleBasePlanId")`);
    }

    public async down(): Promise<void> {
        // Intentionally no-op. This is a production runtime schema repair.
    }
}

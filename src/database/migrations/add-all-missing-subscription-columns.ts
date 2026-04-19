import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Comprehensive catch-up migration: adds every column that the Subscription
 * and Plan entities expect but that may be missing from the production DB
 * because earlier migrations were never run.
 *
 * Uses IF NOT EXISTS so it is safe to run even if some columns already exist.
 */
export class AddAllMissingSubscriptionColumns1745100000000
  implements MigrationInterface
{
  name = 'AddAllMissingSubscriptionColumns1745100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── subscriptions table ──────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "planId" character varying NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "paymentReference" character varying NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "paymentProvider" character varying NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "googleProductId" character varying NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "googlePurchaseToken" character varying NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "googleOrderId" character varying NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" character varying NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "stripeCheckoutSessionId" character varying NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "stripeCustomerId" character varying NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "billingCycle" character varying NULL`,
    );

    // Indexes for subscriptions
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_subscriptions_googlePurchaseToken" ON "subscriptions" ("googlePurchaseToken")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_subscriptions_stripeCustomerId" ON "subscriptions" ("stripeCustomerId")`,
    );

    // ── plans table ───────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "description" text NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "price" decimal(10,2) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "currency" character varying NOT NULL DEFAULT 'usd'`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "billingCycle" character varying NOT NULL DEFAULT 'monthly'`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "stripePriceId" character varying NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "durationDays" integer NOT NULL DEFAULT 30`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "isActive" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "isVisible" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "sortOrder" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "entitlements" jsonb NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "features" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "dailyLikesLimit" integer NOT NULL DEFAULT 10`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "dailySuperLikesLimit" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "dailyComplimentsLimit" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "monthlyRewindsLimit" integer NOT NULL DEFAULT 2`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "weeklyBoostsLimit" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "googleProductId" character varying NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "googleBasePlanId" character varying NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "featureFlags" jsonb NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "limits" jsonb NOT NULL DEFAULT '{}'`,
    );

    // Indexes for plans
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_plans_googleProductId" ON "plans" ("googleProductId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_plans_googleBasePlanId" ON "plans" ("googleBasePlanId")`,
    );

    // ── purchase_transactions table (may not exist) ────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "purchase_transactions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "planId" uuid NULL,
        "provider" character varying NOT NULL,
        "purchaseToken" character varying NULL,
        "productId" character varying NULL,
        "orderId" character varying NULL,
        "status" character varying NOT NULL DEFAULT 'pending',
        "rawVerification" jsonb NOT NULL DEFAULT '{}',
        "transactionDate" timestamp NULL,
        "expiryDate" timestamp NULL,
        "paymentReference" character varying NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_purchase_transactions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_purchase_transactions_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_purchase_transactions_plan" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_purchase_transactions_userId" ON "purchase_transactions" ("userId")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_purchase_transactions_purchaseToken" ON "purchase_transactions" ("purchaseToken")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_purchase_transactions_planId" ON "purchase_transactions" ("planId")`,
    );

    // ── enum values ────────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TYPE "subscriptions_status_enum" ADD VALUE IF NOT EXISTS 'pending_cancellation'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No-op for safety — individual columns can be dropped manually if needed
  }
}

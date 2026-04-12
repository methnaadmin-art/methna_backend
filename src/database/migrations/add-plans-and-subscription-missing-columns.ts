import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlansAndSubscriptionMissingColumns1716000000000 implements MigrationInterface {
    name = 'AddPlansAndSubscriptionMissingColumns1716000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // ─── Plans table: add any missing columns ──────────────
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
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // No-op for safety
    }
}

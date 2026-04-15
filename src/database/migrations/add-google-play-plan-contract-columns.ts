import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGooglePlayPlanContractColumns1719000000000 implements MigrationInterface {
    name = 'AddGooglePlayPlanContractColumns1719000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "plans"
            ADD COLUMN IF NOT EXISTS "googleBasePlanId" character varying NULL
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_plans_googleBasePlanId"
            ON "plans" ("googleBasePlanId")
        `);

        await queryRunner.query(`
            ALTER TABLE "plans"
            ADD COLUMN IF NOT EXISTS "featureFlags" jsonb NOT NULL DEFAULT '{}'
        `);

        await queryRunner.query(`
            ALTER TABLE "plans"
            ADD COLUMN IF NOT EXISTS "limits" jsonb NOT NULL DEFAULT '{}'
        `);

        await queryRunner.query(`
            ALTER TABLE "subscriptions"
            ADD COLUMN IF NOT EXISTS "googleProductId" character varying NULL
        `);

        await queryRunner.query(`
            ALTER TABLE "subscriptions"
            ADD COLUMN IF NOT EXISTS "googlePurchaseToken" character varying NULL
        `);

        await queryRunner.query(`
            ALTER TABLE "subscriptions"
            ADD COLUMN IF NOT EXISTS "googleOrderId" character varying NULL
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_subscriptions_googlePurchaseToken"
            ON "subscriptions" ("googlePurchaseToken")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_subscriptions_googlePurchaseToken"`);
        await queryRunner.query(`ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "googleOrderId"`);
        await queryRunner.query(`ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "googlePurchaseToken"`);
        await queryRunner.query(`ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "googleProductId"`);
        await queryRunner.query(`ALTER TABLE "plans" DROP COLUMN IF EXISTS "limits"`);
        await queryRunner.query(`ALTER TABLE "plans" DROP COLUMN IF EXISTS "featureFlags"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_plans_googleBasePlanId"`);
        await queryRunner.query(`ALTER TABLE "plans" DROP COLUMN IF EXISTS "googleBasePlanId"`);
    }
}

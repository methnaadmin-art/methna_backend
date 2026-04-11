import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionStripeColumns1712000000000 implements MigrationInterface {
    name = 'AddSubscriptionStripeColumns1712000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "subscriptions"
            ADD COLUMN IF NOT EXISTS "stripeCheckoutSessionId" character varying NULL
        `);

        await queryRunner.query(`
            ALTER TABLE "subscriptions"
            ADD COLUMN IF NOT EXISTS "stripeCustomerId" character varying NULL
        `);

        await queryRunner.query(`
            ALTER TABLE "subscriptions"
            ADD COLUMN IF NOT EXISTS "billingCycle" character varying NULL
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_subscriptions_stripeCustomerId"
            ON "subscriptions" ("stripeCustomerId")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_subscriptions_stripeCustomerId"`);

        await queryRunner.query(`
            ALTER TABLE "subscriptions"
            DROP COLUMN IF EXISTS "billingCycle"
        `);

        await queryRunner.query(`
            ALTER TABLE "subscriptions"
            DROP COLUMN IF EXISTS "stripeCustomerId"
        `);

        await queryRunner.query(`
            ALTER TABLE "subscriptions"
            DROP COLUMN IF EXISTS "stripeCheckoutSessionId"
        `);
    }
}

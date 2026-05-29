import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAppleAppStoreSubscriptionColumns1780000000000 implements MigrationInterface {
    name = 'AddAppleAppStoreSubscriptionColumns1780000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "appleProductId" character varying NULL`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_plans_appleProductId" ON "plans" ("appleProductId")`);

        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "paymentPlatform" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "appleProductId" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "appleTransactionId" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "appleOriginalTransactionId" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "appleEnvironment" character varying NULL`);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_subscriptions_appleOriginalTransactionId" ON "subscriptions" ("appleOriginalTransactionId")`,
        );
    }

    public async down(): Promise<void> {
        // Intentionally no-op. This is a production runtime schema addition.
    }
}

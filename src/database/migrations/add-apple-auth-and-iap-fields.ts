import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAppleAuthAndIapFields1776902400000
    implements MigrationInterface
{
    name = 'AddAppleAuthAndIapFields1776902400000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        const columnStatements = [
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "appleSubject" character varying`,
            `ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "iosProductId" character varying`,
            `ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "iosProductId" character varying`,
            `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "appleProductId" character varying`,
            `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "appleTransactionId" character varying`,
            `ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "appleOriginalTransactionId" character varying`,
            `ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "platform" character varying`,
        ];

        for (const statement of columnStatements) {
            await queryRunner.query(statement);
        }

        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_appleSubject_unique" ON "users" ("appleSubject") WHERE "appleSubject" IS NOT NULL`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_plans_iosProductId" ON "plans" ("iosProductId")`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_consumable_products_iosProductId" ON "consumable_products" ("iosProductId")`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_subscriptions_appleTransactionId" ON "subscriptions" ("appleTransactionId")`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_purchase_transactions_platform" ON "purchase_transactions" ("platform")`,
        );
    }

    public async down(): Promise<void> {
        // Intentionally no-op. This is a production-safe additive migration.
    }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConsumableAppleProductId1785000000000 implements MigrationInterface {
    name = 'AddConsumableAppleProductId1785000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "appleProductId" character varying NULL`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_consumable_products_appleProductId" ON "consumable_products" ("appleProductId")`);
    }

    public async down(): Promise<void> {
        // Intentionally no-op.
    }
}

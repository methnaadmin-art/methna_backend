import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPlanStripeProductId1713200000000 implements MigrationInterface {
    name = 'AddPlanStripeProductId1713200000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        const hasColumn = await queryRunner.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'plans' AND column_name = 'stripeProductId'
        `);

        if (hasColumn.length === 0) {
            await queryRunner.query(`ALTER TABLE "plans" ADD COLUMN "stripeProductId" varchar NULL`);
            await queryRunner.query(`CREATE INDEX "IDX_plans_stripeProductId" ON "plans" ("stripeProductId") WHERE "stripeProductId" IS NOT NULL`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_plans_stripeProductId"`);
        await queryRunner.query(`ALTER TABLE "plans" DROP COLUMN IF EXISTS "stripeProductId"`);
    }
}

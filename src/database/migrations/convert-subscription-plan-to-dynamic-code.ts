import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConvertSubscriptionPlanToDynamicCode1718000000000 implements MigrationInterface {
    name = 'ConvertSubscriptionPlanToDynamicCode1718000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "subscriptions"
            ALTER COLUMN "plan" DROP DEFAULT
        `);
        await queryRunner.query(`
            ALTER TABLE "subscriptions"
            ALTER COLUMN "plan" TYPE character varying USING "plan"::text
        `);
        await queryRunner.query(`
            ALTER TABLE "subscriptions"
            ALTER COLUMN "plan" SET DEFAULT 'free'
        `);
        await queryRunner.query(`
            UPDATE "subscriptions" s
            SET "planId" = p.id
            FROM "plans" p
            WHERE s."planId" IS NULL
              AND p.code = s.plan
        `);
        await queryRunner.query(`
            UPDATE "subscriptions" s
            SET "plan" = p.code
            FROM "plans" p
            WHERE s."planId" = p.id
              AND s."plan" IS DISTINCT FROM p.code
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "subscriptions"
            ALTER COLUMN "plan" DROP DEFAULT
        `);
        await queryRunner.query(`
            UPDATE "subscriptions"
            SET "plan" = CASE
                WHEN "plan" = 'free' THEN 'free'
                WHEN "plan" = 'gold' THEN 'gold'
                ELSE 'premium'
            END
        `);
        await queryRunner.query(`
            ALTER TABLE "subscriptions"
            ALTER COLUMN "plan" TYPE "public"."subscriptions_plan_enum"
            USING "plan"::"public"."subscriptions_plan_enum"
        `);
        await queryRunner.query(`
            ALTER TABLE "subscriptions"
            ALTER COLUMN "plan" SET DEFAULT 'free'
        `);
    }
}

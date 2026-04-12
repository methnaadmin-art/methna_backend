import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConvertSubscriptionPlanToDynamicCode1718000000000 implements MigrationInterface {
    name = 'ConvertSubscriptionPlanToDynamicCode1718000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        const plansHasCode = await queryRunner.hasColumn('plans', 'code');
        if (!plansHasCode) {
            await queryRunner.query(`
                ALTER TABLE "plans"
                ADD COLUMN "code" character varying
            `);
        }

        await queryRunner.query(`
            UPDATE "plans"
            SET "code" = NULLIF(BTRIM("code"), '')
            WHERE "code" IS NOT NULL
        `);

        await queryRunner.query(`
            WITH normalized AS (
                SELECT
                    p.id,
                    LOWER(
                        REGEXP_REPLACE(
                            COALESCE(NULLIF(BTRIM(p.name), ''), 'plan'),
                            '[^a-zA-Z0-9]+',
                            '_',
                            'g'
                        )
                    ) AS base_code
                FROM "plans" p
                WHERE p."code" IS NULL
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
                            AND p."code" IS NOT NULL
                            AND LOWER(p."code") = LOWER(s."plan")
        `);
        await queryRunner.query(`
            UPDATE "subscriptions" s
                        SET "plan" = p."code"
            FROM "plans" p
            WHERE s."planId" = p.id
                            AND p."code" IS NOT NULL
                            AND s."plan" IS DISTINCT FROM p."code"
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

import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixSubscriptionSchemaRuntimeDrift1776634800000 implements MigrationInterface {
    name = 'FixSubscriptionSchemaRuntimeDrift1776634800000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1
                    FROM pg_type
                    WHERE typname = 'subscriptions_status_enum'
                ) THEN
                    ALTER TYPE "subscriptions_status_enum" ADD VALUE IF NOT EXISTS 'pending_cancellation';
                    ALTER TYPE "subscriptions_status_enum" ADD VALUE IF NOT EXISTS 'past_due';
                    ALTER TYPE "subscriptions_status_enum" ADD VALUE IF NOT EXISTS 'trial';
                END IF;
            END $$;
        `);

        await queryRunner.query(`
            ALTER TABLE "plans"
            ADD COLUMN IF NOT EXISTS "code" character varying
        `);

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
            ALTER TABLE "plans"
            ALTER COLUMN "code" SET NOT NULL
        `);

        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "IDX_plans_code_unique"
            ON "plans" ("code")
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

    public async down(): Promise<void> {
        // PostgreSQL enum values cannot be safely removed. Keep this migration forward-only.
    }
}

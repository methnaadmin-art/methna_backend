import { MigrationInterface, QueryRunner } from 'typeorm';

export class RepairUserAndAdSchemaRuntimeDrift1776772800000
    implements MigrationInterface
{
    name = 'RepairUserAndAdSchemaRuntimeDrift1776772800000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        const columnStatements = [
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscriptionPlanId" character varying`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isGhostModeEnabled" boolean DEFAULT false`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isPassportActive" boolean DEFAULT false`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "realLocation" jsonb`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passportLocation" jsonb`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "backgroundCheckStatus" character varying`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "backgroundCheckCheckId" character varying`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "backgroundCheckCompletedAt" timestamptz`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "likesBalance" integer DEFAULT 0`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "complimentsBalance" integer DEFAULT 0`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "boostsBalance" integer DEFAULT 0`,
            `ALTER TABLE "ads" ADD COLUMN IF NOT EXISTS "targetGender" character varying`,
            `ALTER TABLE "ads" ADD COLUMN IF NOT EXISTS "targetPlan" character varying`,
            `ALTER TABLE "ads" ADD COLUMN IF NOT EXISTS "targetCountry" character varying`,
            `ALTER TABLE "ads" ADD COLUMN IF NOT EXISTS "targetCity" character varying`,
            `ALTER TABLE "ads" ADD COLUMN IF NOT EXISTS "showEveryNUsers" integer DEFAULT 1`,
            `ALTER TABLE "ads" ADD COLUMN IF NOT EXISTS "weight" integer DEFAULT 1`,
        ];

        for (const statement of columnStatements) {
            await queryRunner.query(statement);
        }

        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_users_subscriptionPlanId" ON "users" ("subscriptionPlanId")`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_users_isGhostModeEnabled" ON "users" ("isGhostModeEnabled")`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_users_isPassportActive" ON "users" ("isPassportActive")`,
        );
    }

    public async down(): Promise<void> {
        // Intentionally no-op. This is a production runtime schema repair.
    }
}

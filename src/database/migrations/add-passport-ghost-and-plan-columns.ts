import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPassportGhostAndPlanColumns1719000000000 implements MigrationInterface {
    name = 'AddPassportGhostAndPlanColumns1719000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "users"
            ADD COLUMN IF NOT EXISTS "subscriptionPlanId" character varying NULL
        `);

        await queryRunner.query(`
            ALTER TABLE "users"
            ADD COLUMN IF NOT EXISTS "isGhostModeEnabled" boolean NOT NULL DEFAULT false
        `);

        await queryRunner.query(`
            ALTER TABLE "users"
            ADD COLUMN IF NOT EXISTS "isPassportActive" boolean NOT NULL DEFAULT false
        `);

        await queryRunner.query(`
            ALTER TABLE "users"
            ADD COLUMN IF NOT EXISTS "realLocation" jsonb NULL
        `);

        await queryRunner.query(`
            ALTER TABLE "users"
            ADD COLUMN IF NOT EXISTS "passportLocation" jsonb NULL
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_users_subscriptionPlanId"
            ON "users" ("subscriptionPlanId")
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_users_isGhostModeEnabled"
            ON "users" ("isGhostModeEnabled")
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_users_isPassportActive"
            ON "users" ("isPassportActive")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_isPassportActive"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_isGhostModeEnabled"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_subscriptionPlanId"`);

        await queryRunner.query(`
            ALTER TABLE "users"
            DROP COLUMN IF EXISTS "passportLocation"
        `);

        await queryRunner.query(`
            ALTER TABLE "users"
            DROP COLUMN IF EXISTS "realLocation"
        `);

        await queryRunner.query(`
            ALTER TABLE "users"
            DROP COLUMN IF EXISTS "isPassportActive"
        `);

        await queryRunner.query(`
            ALTER TABLE "users"
            DROP COLUMN IF EXISTS "isGhostModeEnabled"
        `);

        await queryRunner.query(`
            ALTER TABLE "users"
            DROP COLUMN IF EXISTS "subscriptionPlanId"
        `);
    }
}

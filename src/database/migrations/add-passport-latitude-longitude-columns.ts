import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds normalized numeric columns `passportLatitude` and `passportLongitude`
 * to the users table, and backfills them from the existing `passportLocation`
 * JSONB column.
 *
 * This eliminates the need for regex/JSON-parsing inside SQL queries — the
 * search service can now reference these columns directly with a simple CASE.
 */
export class AddPassportLatitudeLongitudeColumns1740000000000 implements MigrationInterface {
    name = 'AddPassportLatitudeLongitudeColumns1740000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. Add the numeric columns
        await queryRunner.query(`
            ALTER TABLE "users"
            ADD COLUMN IF NOT EXISTS "passportLatitude" double precision NULL
        `);
        await queryRunner.query(`
            ALTER TABLE "users"
            ADD COLUMN IF NOT EXISTS "passportLongitude" double precision NULL
        `);

        // 2. Backfill from existing passportLocation JSONB
        //    Only write valid numeric values within the geographic range.
        //    Uses jsonb_typeof to safely check without regex.
        await queryRunner.query(`
            UPDATE "users"
            SET "passportLatitude" = ("passportLocation"->>'latitude')::double precision
            WHERE "passportLocation" IS NOT NULL
              AND jsonb_typeof("passportLocation"->'latitude') = 'number'
              AND ("passportLocation"->>'latitude')::double precision BETWEEN -90 AND 90
        `);
        await queryRunner.query(`
            UPDATE "users"
            SET "passportLongitude" = ("passportLocation"->>'longitude')::double precision
            WHERE "passportLocation" IS NOT NULL
              AND jsonb_typeof("passportLocation"->'longitude') = 'number'
              AND ("passportLocation"->>'longitude')::double precision BETWEEN -180 AND 180
        `);

        // 3. Add indexes for search performance
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_users_passport_latitude"
            ON "users" ("passportLatitude")
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_users_passport_longitude"
            ON "users" ("passportLongitude")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_passport_longitude"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_passport_latitude"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "passportLongitude"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "passportLatitude"`);
    }
}

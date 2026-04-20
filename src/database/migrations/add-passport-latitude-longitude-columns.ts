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

        // 2. Backfill from existing passportLocation JSONB.
        //    Use nested CASE to guarantee short-circuit: only cast when value is
        //    confirmed to be a JSON number type. No regex, no WHERE AND ordering
        //    assumptions. Values outside geographic range are written as NULL.
        await queryRunner.query(`
            UPDATE "users"
            SET "passportLatitude" = CASE
                WHEN jsonb_typeof("passportLocation"->'latitude') = 'number'
                THEN (
                    CASE
                        WHEN ("passportLocation"->>'latitude')::double precision BETWEEN -90 AND 90
                        THEN ("passportLocation"->>'latitude')::double precision
                        ELSE NULL
                    END
                )
                ELSE NULL
            END
            WHERE "passportLocation" IS NOT NULL
        `);
        await queryRunner.query(`
            UPDATE "users"
            SET "passportLongitude" = CASE
                WHEN jsonb_typeof("passportLocation"->'longitude') = 'number'
                THEN (
                    CASE
                        WHEN ("passportLocation"->>'longitude')::double precision BETWEEN -180 AND 180
                        THEN ("passportLocation"->>'longitude')::double precision
                        ELSE NULL
                    END
                )
                ELSE NULL
            END
            WHERE "passportLocation" IS NOT NULL
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

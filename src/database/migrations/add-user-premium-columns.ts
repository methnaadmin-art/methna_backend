import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserPremiumColumns1711000000000 implements MigrationInterface {
    name = 'AddUserPremiumColumns1711000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "users"
            ADD COLUMN IF NOT EXISTS "isPremium" boolean NOT NULL DEFAULT false
        `);

        await queryRunner.query(`
            ALTER TABLE "users"
            ADD COLUMN IF NOT EXISTS "premiumStartDate" TIMESTAMPTZ NULL
        `);

        await queryRunner.query(`
            ALTER TABLE "users"
            ADD COLUMN IF NOT EXISTS "premiumExpiryDate" TIMESTAMPTZ NULL
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_users_isPremium"
            ON "users" ("isPremium")
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_users_premiumExpiryDate"
            ON "users" ("premiumExpiryDate")
            WHERE "isPremium" = true
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_premiumExpiryDate"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_isPremium"`);

        await queryRunner.query(`
            ALTER TABLE "users"
            DROP COLUMN IF EXISTS "premiumExpiryDate"
        `);

        await queryRunner.query(`
            ALTER TABLE "users"
            DROP COLUMN IF EXISTS "premiumStartDate"
        `);

        await queryRunner.query(`
            ALTER TABLE "users"
            DROP COLUMN IF EXISTS "isPremium"
        `);
    }
}

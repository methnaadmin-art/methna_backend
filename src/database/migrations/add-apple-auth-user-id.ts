import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAppleAuthUserId1780000000001 implements MigrationInterface {
    name = 'AddAppleAuthUserId1780000000001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "appleUserId" character varying NULL`);
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_appleUserId_unique" ON "users" ("appleUserId") WHERE "appleUserId" IS NOT NULL`,
        );
    }

    public async down(): Promise<void> {
        // Intentionally no-op. This is a production runtime schema addition.
    }
}

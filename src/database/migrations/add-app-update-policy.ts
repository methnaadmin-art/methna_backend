import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAppUpdatePolicy1776816000000 implements MigrationInterface {
    name = 'AddAppUpdatePolicy1776816000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "app_update_policies" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "isActive" boolean NOT NULL DEFAULT false,
                "minimumSupportedVersion" character varying(64) NULL,
                "latestVersion" character varying(64) NULL,
                "title" character varying(160) NULL,
                "hardUpdateMessage" text NULL,
                "softUpdateMessage" text NULL,
                "storeUrlAndroid" character varying(512) NULL,
                "storeUrliOS" character varying(512) NULL,
                "updatedById" character varying(64) NULL,
                "createdAt" timestamp NOT NULL DEFAULT now(),
                "updatedAt" timestamp NOT NULL DEFAULT now()
            )
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_app_update_policies_active_updated"
            ON "app_update_policies" ("isActive", "updatedAt")
        `);
    }

    public async down(): Promise<void> {
        // Intentionally no-op. This is a production-safe schema addition.
    }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVerificationSupport1716000000000 implements MigrationInterface {
    name = 'AddVerificationSupport1716000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "selfieVerified" boolean NOT NULL DEFAULT false`,
        );
        await queryRunner.query(
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "selfieUrl" character varying NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "documentUrl" character varying NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "documentType" character varying NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "documentVerified" boolean NOT NULL DEFAULT false`,
        );
        await queryRunner.query(
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "documentVerifiedAt" timestamptz NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "documentRejectionReason" text NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "verification" jsonb NULL DEFAULT '{}'::jsonb`,
        );
    }

    public async down(): Promise<void> {
        // Intentionally left blank to avoid destructive schema changes in production.
    }
}

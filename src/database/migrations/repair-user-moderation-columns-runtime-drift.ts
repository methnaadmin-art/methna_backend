import { MigrationInterface, QueryRunner } from 'typeorm';

export class RepairUserModerationColumnsRuntimeDrift1776643200000 implements MigrationInterface {
    name = 'RepairUserModerationColumnsRuntimeDrift1776643200000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DO $$ BEGIN
            ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS 'limited';
        EXCEPTION
            WHEN undefined_object THEN NULL;
        END $$;`);
        await queryRunner.query(`DO $$ BEGIN
            ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS 'shadow_suspended';
        EXCEPTION
            WHEN undefined_object THEN NULL;
        END $$;`);
        await queryRunner.query(`DO $$ BEGIN
            ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS 'deactivated';
        EXCEPTION
            WHEN undefined_object THEN NULL;
        END $$;`);
        await queryRunner.query(`DO $$ BEGIN
            ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS 'closed';
        EXCEPTION
            WHEN undefined_object THEN NULL;
        END $$;`);
        await queryRunner.query(`DO $$ BEGIN
            ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS 'pending_verification';
        EXCEPTION
            WHEN undefined_object THEN NULL;
        END $$;`);
        await queryRunner.query(`DO $$ BEGIN
            ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS 'rejected';
        EXCEPTION
            WHEN undefined_object THEN NULL;
        END $$;`);
        await queryRunner.query(`DO $$ BEGIN
            ALTER TYPE "users_role_enum" ADD VALUE IF NOT EXISTS 'moderator';
        EXCEPTION
            WHEN undefined_object THEN NULL;
        END $$;`);

        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "statusReason" text NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "moderationReasonCode" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "moderationReasonText" text NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "actionRequired" character varying NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "supportMessage" text NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isUserVisible" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "moderationExpiresAt" timestamptz NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "internalAdminNote" text NULL`);
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "updatedByAdminId" character varying NULL`);
    }

    public async down(): Promise<void> {
        // Intentionally no-op. Dropping live auth/moderation columns is unsafe.
    }
}

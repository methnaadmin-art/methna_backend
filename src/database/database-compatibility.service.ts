import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseCompatibilityService implements OnModuleInit {
    private readonly logger = new Logger(DatabaseCompatibilityService.name);

    constructor(@InjectDataSource() private readonly dataSource: DataSource) { }

    async onModuleInit() {
        await this.ensureCompatibility();
    }

    private async ensureCompatibility() {
        if (!this.dataSource.isInitialized || this.dataSource.options.type !== 'postgres') {
            return;
        }

        const enumStatements = [
            {
                label: 'users_status_enum.rejected',
                sql: `DO $$ BEGIN
                    ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS 'rejected';
                EXCEPTION
                    WHEN undefined_object THEN NULL;
                END $$;`,
            },
            {
                label: 'notifications_type_enum.ticket',
                sql: `DO $$ BEGIN
                    ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'ticket';
                EXCEPTION
                    WHEN undefined_object THEN NULL;
                END $$;`,
            },
        ];

        const columnStatements = [
            { label: 'users.readReceipts', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "readReceipts" boolean DEFAULT true' },
            { label: 'users.typingIndicator', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "typingIndicator" boolean DEFAULT true' },
            { label: 'users.autoDownloadMedia', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "autoDownloadMedia" boolean DEFAULT true' },
            { label: 'users.receiveDMs', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "receiveDMs" boolean DEFAULT true' },
            { label: 'users.locationEnabled', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locationEnabled" boolean DEFAULT false' },
            { label: 'users.isPremium', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isPremium" boolean DEFAULT false' },
            { label: 'users.premiumStartDate', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "premiumStartDate" timestamptz' },
            { label: 'users.premiumExpiryDate', sql: 'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "premiumExpiryDate" timestamptz' },
            { label: 'users.verification', sql: `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "verification" jsonb DEFAULT '{}'::jsonb` },
        ];

        for (const statement of [...enumStatements, ...columnStatements]) {
            await this.runStatement(statement.label, statement.sql);
        }

        await this.runStatement(
            'users.verification backfill',
            `UPDATE "users"
             SET "verification" = jsonb_build_object(
                 'selfie',
                 jsonb_build_object(
                     'status',
                     CASE
                         WHEN "selfieVerified" = true THEN 'approved'
                         WHEN "selfieUrl" IS NOT NULL THEN 'pending'
                         ELSE 'not_uploaded'
                     END,
                     'url', "selfieUrl",
                     'rejectionReason', NULL,
                     'submittedAt', NULL,
                     'reviewedAt', NULL,
                     'reviewedBy', NULL
                 ),
                 'marital_status',
                 jsonb_build_object(
                     'status', 'not_uploaded',
                     'url', NULL,
                     'rejectionReason', NULL,
                     'submittedAt', NULL,
                     'reviewedAt', NULL,
                     'reviewedBy', NULL
                 )
             )
             WHERE "verification" IS NULL OR "verification" = '{}'::jsonb`,
        );

        await this.runStatement(
            'users premium backfill from subscriptions',
            `WITH latest_active_premium AS (
                SELECT DISTINCT ON ("userId")
                    "userId",
                    "startDate",
                    "endDate"
                FROM "subscriptions"
                WHERE status = 'active'
                  AND plan <> 'free'
                  AND ("endDate" IS NULL OR "endDate" > NOW())
                ORDER BY "userId", "endDate" DESC NULLS LAST, "createdAt" DESC
            )
            UPDATE "users" AS u
            SET
                "isPremium" = CASE
                    WHEN s."startDate" IS NULL OR s."startDate" <= NOW() THEN true
                    ELSE false
                END,
                "premiumStartDate" = s."startDate",
                "premiumExpiryDate" = s."endDate"
            FROM latest_active_premium AS s
            WHERE u.id = s."userId"`,
        );

        await this.runStatement(
            'users non-premium reset',
            `UPDATE "users"
             SET
                 "isPremium" = false,
                 "premiumStartDate" = NULL,
                 "premiumExpiryDate" = NULL
             WHERE id NOT IN (
                 SELECT DISTINCT "userId"
                 FROM "subscriptions"
                 WHERE status = 'active'
                   AND plan <> 'free'
                   AND ("endDate" IS NULL OR "endDate" > NOW())
             )`,
        );

        this.logger.log('Database compatibility sync completed');
    }

    private async runStatement(label: string, sql: string) {
        try {
            await this.dataSource.query(sql);
        } catch (error: any) {
            this.logger.warn(`${label} skipped: ${error?.message ?? error}`);
        }
    }
}


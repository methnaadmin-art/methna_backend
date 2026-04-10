/**
 * Database Sync Script
 * Run this to add missing columns to the users table.
 */

import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

const projectRoot = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });
dotenv.config({ path: path.join(projectRoot, '.env.example') });

function buildDatabaseUrl() {
    if (process.env.DATABASE_URL) {
        return process.env.DATABASE_URL;
    }

    const host = process.env.DB_HOST;
    const port = process.env.DB_PORT || '5432';
    const username = process.env.DB_USERNAME;
    const password = process.env.DB_PASSWORD;
    const database = process.env.DB_NAME;

    if (!host || !username || !password || !database) {
        return null;
    }

    const encodedUsername = encodeURIComponent(username);
    const encodedPassword = encodeURIComponent(password);
    return `postgresql://${encodedUsername}:${encodedPassword}@${host}:${port}/${database}?sslmode=require`;
}

const DATABASE_URL = buildDatabaseUrl();

async function syncDatabase() {
    if (!DATABASE_URL) {
        console.error('DATABASE_URL not set and DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_NAME are incomplete');
        process.exit(1);
    }

    const client = new Client({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false },
    });

    try {
        await client.connect();
        console.log('Connected to database');

        const enumStatements = [
            `DO $$ BEGIN
                ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS 'rejected';
            EXCEPTION
                WHEN undefined_object THEN NULL;
            END $$;`,
            `DO $$ BEGIN
                ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS 'ticket';
            EXCEPTION
                WHEN undefined_object THEN NULL;
            END $$;`,
        ];

        for (const statement of enumStatements) {
            try {
                await client.query(statement);
            } catch (err: any) {
                console.error(`Enum sync error: ${err.message}`);
            }
        }

        const alterStatements = [
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS "readReceipts" boolean DEFAULT true`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS "typingIndicator" boolean DEFAULT true`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS "autoDownloadMedia" boolean DEFAULT true`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS "receiveDMs" boolean DEFAULT true`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS "locationEnabled" boolean DEFAULT false`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS "isPremium" boolean DEFAULT false`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS "premiumStartDate" timestamptz`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS "premiumExpiryDate" timestamptz`,
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS "verification" jsonb DEFAULT '{}'::jsonb`,
        ];

        for (const statement of alterStatements) {
            try {
                await client.query(statement);
                console.log(`Ensured ${statement}`);
            } catch (err: any) {
                console.error(`Error while ensuring schema: ${err.message}`);
            }
        }

        await client.query(`
            UPDATE users
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
            WHERE "verification" IS NULL OR "verification" = '{}'::jsonb
        `);

        await client.query(`
            WITH latest_active_premium AS (
                SELECT DISTINCT ON ("userId")
                    "userId",
                    "startDate",
                    "endDate"
                FROM subscriptions
                WHERE status = 'active'
                  AND plan <> 'free'
                  AND ("endDate" IS NULL OR "endDate" > NOW())
                ORDER BY "userId", "endDate" DESC NULLS LAST, "createdAt" DESC
            )
            UPDATE users AS u
            SET
                "isPremium" = CASE
                    WHEN s."startDate" IS NULL OR s."startDate" <= NOW() THEN true
                    ELSE false
                END,
                "premiumStartDate" = s."startDate",
                "premiumExpiryDate" = s."endDate"
            FROM latest_active_premium AS s
            WHERE u.id = s."userId"
        `);

        await client.query(`
            UPDATE users
            SET
                "isPremium" = false,
                "premiumStartDate" = NULL,
                "premiumExpiryDate" = NULL
            WHERE id NOT IN (
                SELECT DISTINCT "userId"
                FROM subscriptions
                WHERE status = 'active'
                  AND plan <> 'free'
                  AND ("endDate" IS NULL OR "endDate" > NOW())
            )
        `);

        console.log('Database sync complete');
    } catch (error) {
        console.error('Database sync failed:', error);
        process.exit(1);
    } finally {
        await client.end();
    }
}

syncDatabase();

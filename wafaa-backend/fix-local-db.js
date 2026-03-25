const { Client } = require('pg');

async function runLocal() {
    console.log("Attempting local DB connection...");
    const client = new Client({
        host: 'localhost',
        port: 5432,
        user: 'postgres',
        password: 'YOUR_SUPABASE_DB_PASSWORD', // Fallback
        database: 'postgres'
    });

    try {
        // Try without password or with generic local ones if needed
        const client2 = new Client({
            host: 'localhost',
            port: 5432,
            user: 'postgres',
            password: 'mouadchiali',
            database: 'postgres'
        });
        
        await client2.connect();
        console.log("✅ Connected to LOCALHOST PostgreSQL!");

        const queries = [
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notificationsEnabled" boolean NOT NULL DEFAULT true;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "matchNotifications" boolean NOT NULL DEFAULT true;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "messageNotifications" boolean NOT NULL DEFAULT true;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "likeNotifications" boolean NOT NULL DEFAULT true;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "profileVisitorNotifications" boolean NOT NULL DEFAULT false;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "eventsNotifications" boolean NOT NULL DEFAULT false;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "safetyAlertNotifications" boolean NOT NULL DEFAULT true;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "promotionsNotifications" boolean NOT NULL DEFAULT false;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "inAppRecommendationNotifications" boolean NOT NULL DEFAULT false;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "weeklySummaryNotifications" boolean NOT NULL DEFAULT false;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "connectionRequestNotifications" boolean NOT NULL DEFAULT false;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "surveyNotifications" boolean NOT NULL DEFAULT false;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "locationEnabled" boolean NOT NULL DEFAULT true;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "boostedUntil" timestamp without time zone;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isShadowBanned" boolean NOT NULL DEFAULT false;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "trustScore" integer NOT NULL DEFAULT 100;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "flagCount" integer NOT NULL DEFAULT 0;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastKnownIp" character varying;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deviceCount" integer NOT NULL DEFAULT 0;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "selfieVerified" boolean NOT NULL DEFAULT false;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "selfieUrl" character varying;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "documentUrl" character varying;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "documentType" character varying;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "documentVerified" boolean NOT NULL DEFAULT false;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "documentVerifiedAt" timestamp without time zone;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "documentRejectionReason" character varying;`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "fcmToken" character varying;`
        ];

        for (const q of queries) {
            await client2.query(q);
        }
        console.log("🎉 SUCCESS: All missing columns added to LOCAL database.");
        await client2.end();
        return;
    } catch (e) {
        console.log("Local connection with 'mouadchiali' failed:", e.message);
    }
}

runLocal();

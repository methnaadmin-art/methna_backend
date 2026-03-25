const { Client } = require('pg');

async function patchNeonDb() {
    const connectionString = 'postgresql://neondb_owner:npg_bjT5LpZuIhq0@ep-noisy-sunset-ad4ar2g1-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
    
    console.log("Connecting to Neon DB...");
    const client = new Client({ connectionString });
    
    try {
        await client.connect();
        console.log("✅ Successfully connected to Neon!");

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
            console.log(`Executing: ${q.split('ADD COLUMN IF NOT EXISTS ')[1]}`);
            await client.query(q);
        }

        console.log("🎉 SUCCESS: All missing columns added to the Neon Database!");
    } catch (e) {
        console.error("❌ Neon connection/query failed:", e.message);
    } finally {
        await client.end();
    }
}

patchNeonDb();

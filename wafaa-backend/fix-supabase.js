// fix-supabase.js
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const dns = require('dns');

// Force IPv4 if IPv6 resolution fails
dns.setDefaultResultOrder('ipv4first');

// Load env from current directory or parent
let envFile = path.join(__dirname, '.env');
if (!fs.existsSync(envFile)) {
    envFile = path.join(__dirname, '../.env');
}

if (fs.existsSync(envFile)) {
    const envConfig = fs.readFileSync(envFile, 'utf8').split('\n');
    for (const line of envConfig) {
        if (line.includes('=')) {
            const [key, ...value] = line.split('=');
            if (key.trim()) process.env[key.trim()] = value.join('=').trim().replace(/^"|"$/g, '');
        }
    }
}

async function run() {
    const dbHost = process.env.DB_HOST || 'db.hjojxhcuokbflvemztji.supabase.co';
    const dbPort = process.env.DB_PORT || 5432;
    const dbUser = process.env.DB_USERNAME || 'postgres';
    const dbPass = process.env.DB_PASSWORD || 'mouadchiali';
    const dbName = process.env.DB_NAME || 'postgres';

    console.log(`Connecting to: ${dbHost}:${dbPort} as ${dbUser}`);

    const client = new Client({
        host: dbHost,
        port: parseInt(dbPort),
        user: dbUser,
        password: dbPass,
        database: dbName,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000
    });
    
    try {
        await client.connect();
        console.log('✅ Connected to Supabase DB successfully.');

        // Add all missing notification columns
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
            console.log(`Running: ${q.split('ADD COLUMN IF NOT EXISTS')[1]}`);
            await client.query(q);
        }

        console.log("🎉 All missing columns have been successfully added to 'users' table.");
    } catch (err) {
        console.error('❌ DB Sync Error:', err.message);
    } finally {
        await client.end();
    }
}

run();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { DataSource } from 'typeorm';

async function forceSync() {
    console.log('Starting Nest context for DB sync...');
    const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    const dataSource = app.get(DataSource);
    
    if (!dataSource.isInitialized) {
        await dataSource.initialize();
    }
    
    console.log('Connected to DB:', dataSource.options.database, 'on host:', (dataSource.options as any).host || 'default');

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
        try {
            await dataSource.query(q);
            console.log(`✅ Success: ${q.split('ADD COLUMN IF NOT EXISTS ')[1]}`);
        } catch (e) {
            console.log(`⚠️ Skipped/Error: ${q.split('ADD COLUMN IF NOT EXISTS ')[1]} - ${e.message}`);
        }
    }
    
    console.log('🎉 Database perfectly synced with new columns.');
    await app.close();
}

forceSync().catch(console.error);

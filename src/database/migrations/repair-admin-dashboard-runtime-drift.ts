import { MigrationInterface, QueryRunner } from 'typeorm';

export class RepairAdminDashboardRuntimeDrift1776733200000 implements MigrationInterface {
    name = 'RepairAdminDashboardRuntimeDrift1776733200000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "analytics_events" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "eventType" character varying NOT NULL,
                "userId" character varying NULL,
                "metadata" jsonb NULL,
                "eventDate" date NOT NULL DEFAULT CURRENT_DATE,
                "createdAt" timestamp NOT NULL DEFAULT now()
            )
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "consumable_products" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "code" character varying NOT NULL UNIQUE,
                "title" character varying NOT NULL,
                "description" text NULL,
                "type" character varying NOT NULL,
                "quantity" integer NOT NULL DEFAULT 0,
                "price" decimal(10, 2) NOT NULL DEFAULT 0,
                "currency" character varying NOT NULL DEFAULT 'usd',
                "isActive" boolean NOT NULL DEFAULT true,
                "isArchived" boolean NOT NULL DEFAULT false,
                "platformAvailability" character varying NOT NULL DEFAULT 'all',
                "sortOrder" integer NOT NULL DEFAULT 0,
                "googleProductId" character varying NULL,
                "stripePriceId" character varying NULL,
                "stripeProductId" character varying NULL,
                "createdAt" timestamp NOT NULL DEFAULT now(),
                "updatedAt" timestamp NOT NULL DEFAULT now()
            )
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "purchase_transactions" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "userId" uuid NOT NULL,
                "planId" uuid NULL,
                "consumableProductId" uuid NULL,
                "provider" character varying NOT NULL,
                "purchaseToken" character varying NULL,
                "productId" character varying NULL,
                "orderId" character varying NULL,
                "status" character varying NOT NULL DEFAULT 'pending',
                "rawVerification" jsonb NOT NULL DEFAULT '{}'::jsonb,
                "transactionDate" timestamp NULL,
                "expiryDate" timestamp NULL,
                "paymentReference" character varying NULL,
                "createdAt" timestamp NOT NULL DEFAULT now(),
                "updatedAt" timestamp NOT NULL DEFAULT now()
            )
        `);

        const columnStatements = [
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "likesBalance" integer DEFAULT 0`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "complimentsBalance" integer DEFAULT 0`,
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "boostsBalance" integer DEFAULT 0`,
            `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "user1Id" character varying`,
            `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "user2Id" character varying`,
            `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "matchId" character varying`,
            `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "lastMessageContent" character varying`,
            `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "lastMessageAt" timestamp`,
            `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "lastMessageSenderId" character varying`,
            `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "user1UnreadCount" integer DEFAULT 0`,
            `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "user2UnreadCount" integer DEFAULT 0`,
            `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "user1Muted" boolean DEFAULT false`,
            `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "user2Muted" boolean DEFAULT false`,
            `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "isActive" boolean DEFAULT true`,
            `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "isLocked" boolean DEFAULT false`,
            `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "lockReason" character varying`,
            `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "isFlagged" boolean DEFAULT false`,
            `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "flagReason" character varying`,
            `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now()`,
            `ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now()`,
            `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "conversationId" character varying`,
            `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "matchId" character varying`,
            `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "senderId" character varying`,
            `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "content" text DEFAULT ''`,
            `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "type" character varying DEFAULT 'text'`,
            `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "status" character varying DEFAULT 'sent'`,
            `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "deliveredAt" timestamp`,
            `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "readAt" timestamp`,
            `ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now()`,
            `ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "eventType" character varying`,
            `ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "userId" character varying`,
            `ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "metadata" jsonb`,
            `ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "eventDate" date DEFAULT CURRENT_DATE`,
            `ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now()`,
            `ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "code" character varying`,
            `ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "title" character varying`,
            `ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "description" text`,
            `ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "type" character varying`,
            `ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "quantity" integer DEFAULT 0`,
            `ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "price" decimal(10, 2) DEFAULT 0`,
            `ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "currency" character varying DEFAULT 'usd'`,
            `ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "isActive" boolean DEFAULT true`,
            `ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "isArchived" boolean DEFAULT false`,
            `ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "platformAvailability" character varying DEFAULT 'all'`,
            `ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "sortOrder" integer DEFAULT 0`,
            `ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "googleProductId" character varying`,
            `ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "stripePriceId" character varying`,
            `ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "stripeProductId" character varying`,
            `ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now()`,
            `ALTER TABLE "consumable_products" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now()`,
            `ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "consumableProductId" uuid`,
            `ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "provider" character varying`,
            `ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "purchaseToken" character varying`,
            `ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "productId" character varying`,
            `ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "orderId" character varying`,
            `ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "status" character varying DEFAULT 'pending'`,
            `ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "rawVerification" jsonb DEFAULT '{}'::jsonb`,
            `ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "transactionDate" timestamp`,
            `ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "expiryDate" timestamp`,
            `ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "paymentReference" character varying`,
            `ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "createdAt" timestamp DEFAULT now()`,
            `ALTER TABLE "purchase_transactions" ADD COLUMN IF NOT EXISTS "updatedAt" timestamp DEFAULT now()`,
            `ALTER TABLE "likes" ADD COLUMN IF NOT EXISTS "type" character varying DEFAULT 'like'`,
            `ALTER TABLE "likes" ADD COLUMN IF NOT EXISTS "isLike" boolean DEFAULT true`,
            `ALTER TABLE "likes" ADD COLUMN IF NOT EXISTS "complimentMessage" character varying(500)`,
            `ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "matchedAt" timestamp DEFAULT now()`,
            `ALTER TABLE "matches" ADD COLUMN IF NOT EXISTS "status" character varying DEFAULT 'active'`,
            `ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "status" character varying DEFAULT 'pending'`,
            `ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "moderatorNote" character varying`,
            `ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "resolvedById" character varying`,
            `ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "moderationStatus" character varying DEFAULT 'approved'`,
            `ALTER TABLE "photos" ADD COLUMN IF NOT EXISTS "moderationNote" character varying`,
            `ALTER TABLE "boosts" ADD COLUMN IF NOT EXISTS "isActive" boolean DEFAULT true`,
            `ALTER TABLE "boosts" ADD COLUMN IF NOT EXISTS "type" character varying DEFAULT 'paid'`,
            `ALTER TABLE "boosts" ADD COLUMN IF NOT EXISTS "profileViewsGained" integer DEFAULT 0`,
        ];

        for (const statement of columnStatements) {
            await queryRunner.query(statement);
        }

        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_analytics_type_date" ON "analytics_events" ("eventType", "eventDate")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_analytics_user_date" ON "analytics_events" ("userId", "eventDate")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_consumable_products_code" ON "consumable_products" ("code")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_consumable_products_googleProductId" ON "consumable_products" ("googleProductId") WHERE "googleProductId" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_consumable_products_stripePriceId" ON "consumable_products" ("stripePriceId") WHERE "stripePriceId" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_consumable_products_stripeProductId" ON "consumable_products" ("stripeProductId") WHERE "stripeProductId" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_purchase_transactions_consumableProductId" ON "purchase_transactions" ("consumableProductId")`);
        await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_purchase_transactions_purchaseToken" ON "purchase_transactions" ("purchaseToken") WHERE "purchaseToken" IS NOT NULL`);
    }

    public async down(): Promise<void> {
        // Intentionally no-op. This is a production runtime schema repair.
    }
}

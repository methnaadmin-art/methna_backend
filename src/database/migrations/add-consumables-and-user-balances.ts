import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConsumablesAndUserBalances1719200000000 implements MigrationInterface {
    name = 'AddConsumablesAndUserBalances1719200000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // ─── 1. Create consumable_products table ─────────────────────
        const hasConsumableTable = await queryRunner.query(`
            SELECT table_name FROM information_schema.tables
            WHERE table_name = 'consumable_products'
        `);

        if (hasConsumableTable.length === 0) {
            await queryRunner.query(`
                CREATE TABLE "consumable_products" (
                    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                    "code" varchar NOT NULL UNIQUE,
                    "title" varchar NOT NULL,
                    "description" text NULL,
                    "type" varchar NOT NULL,
                    "quantity" int NOT NULL,
                    "price" decimal(10, 2) NOT NULL,
                    "currency" varchar NOT NULL DEFAULT 'usd',
                    "isActive" boolean NOT NULL DEFAULT true,
                    "isArchived" boolean NOT NULL DEFAULT false,
                    "platformAvailability" varchar NOT NULL DEFAULT 'all',
                    "sortOrder" int NOT NULL DEFAULT 0,
                    "googleProductId" varchar NULL,
                    "stripePriceId" varchar NULL,
                    "stripeProductId" varchar NULL,
                    "createdAt" timestamp NOT NULL DEFAULT now(),
                    "updatedAt" timestamp NOT NULL DEFAULT now()
                )
            `);
            await queryRunner.query(`CREATE INDEX "IDX_consumable_products_code" ON "consumable_products" ("code")`);
            await queryRunner.query(`CREATE INDEX "IDX_consumable_products_googleProductId" ON "consumable_products" ("googleProductId") WHERE "googleProductId" IS NOT NULL`);
            await queryRunner.query(`CREATE INDEX "IDX_consumable_products_stripePriceId" ON "consumable_products" ("stripePriceId") WHERE "stripePriceId" IS NOT NULL`);
            await queryRunner.query(`CREATE INDEX "IDX_consumable_products_stripeProductId" ON "consumable_products" ("stripeProductId") WHERE "stripeProductId" IS NOT NULL`);
        }

        // ─── 2. Create purchase_transactions table ────────────────────
        const hasPurchaseTable = await queryRunner.query(`
            SELECT table_name FROM information_schema.tables
            WHERE table_name = 'purchase_transactions'
        `);

        if (hasPurchaseTable.length === 0) {
            await queryRunner.query(`
                CREATE TABLE "purchase_transactions" (
                    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                    "userId" uuid NOT NULL,
                    "planId" uuid NULL,
                    "consumableProductId" uuid NULL,
                    "provider" varchar NOT NULL,
                    "purchaseToken" varchar NULL,
                    "productId" varchar NULL,
                    "orderId" varchar NULL,
                    "status" varchar NOT NULL DEFAULT 'pending',
                    "rawVerification" jsonb NOT NULL DEFAULT '{}',
                    "transactionDate" timestamp NULL,
                    "expiryDate" timestamp NULL,
                    "paymentReference" varchar NULL,
                    "createdAt" timestamp NOT NULL DEFAULT now(),
                    "updatedAt" timestamp NOT NULL DEFAULT now()
                )
            `);
            await queryRunner.query(`CREATE INDEX "IDX_purchase_transactions_userId" ON "purchase_transactions" ("userId")`);
            await queryRunner.query(`CREATE INDEX "IDX_purchase_transactions_planId" ON "purchase_transactions" ("planId")`);
            await queryRunner.query(`CREATE INDEX "IDX_purchase_transactions_consumableProductId" ON "purchase_transactions" ("consumableProductId")`);
            await queryRunner.query(`CREATE UNIQUE INDEX "IDX_purchase_transactions_purchaseToken" ON "purchase_transactions" ("purchaseToken") WHERE "purchaseToken" IS NOT NULL`);
            await queryRunner.query(`ALTER TABLE "purchase_transactions" ADD CONSTRAINT "FK_purchase_transactions_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE`);
            await queryRunner.query(`ALTER TABLE "purchase_transactions" ADD CONSTRAINT "FK_purchase_transactions_plan" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL`);
            await queryRunner.query(`ALTER TABLE "purchase_transactions" ADD CONSTRAINT "FK_purchase_transactions_consumable" FOREIGN KEY ("consumableProductId") REFERENCES "consumable_products"("id") ON DELETE SET NULL`);
        }

        // ─── 3. Add user balance columns ─────────────────────────────
        const userBalanceCols = await queryRunner.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'users' AND column_name IN ('likesBalance', 'complimentsBalance', 'boostsBalance')
        `);
        const existingCols = new Set(userBalanceCols.map((r: any) => r.column_name));

        if (!existingCols.has('likesBalance')) {
            await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "likesBalance" int NOT NULL DEFAULT 0`);
        }
        if (!existingCols.has('complimentsBalance')) {
            await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "complimentsBalance" int NOT NULL DEFAULT 0`);
        }
        if (!existingCols.has('boostsBalance')) {
            await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "boostsBalance" int NOT NULL DEFAULT 0`);
        }

        // ─── 4. Make support_tickets.userId nullable + add contactEmail ─
        const supportCols = await queryRunner.query(`
            SELECT column_name, is_nullable FROM information_schema.columns
            WHERE table_name = 'support_tickets' AND column_name IN ('userId', 'contactEmail')
        `);
        const supportColMap = new Map(supportCols.map((r: any) => [r.column_name, r.is_nullable]));

        if (supportColMap.has('userId') && supportColMap.get('userId') === 'NO') {
            await queryRunner.query(`ALTER TABLE "support_tickets" ALTER COLUMN "userId" DROP NOT NULL`);
        }
        if (!supportColMap.has('contactEmail')) {
            await queryRunner.query(`ALTER TABLE "support_tickets" ADD COLUMN "contactEmail" varchar NULL`);
        }

        // ─── 5. Create faqs table ────────────────────────────────────
        const hasFaqTable = await queryRunner.query(`
            SELECT table_name FROM information_schema.tables
            WHERE table_name = 'faqs'
        `);

        if (hasFaqTable.length === 0) {
            await queryRunner.query(`
                CREATE TABLE "faqs" (
                    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                    "question" varchar NOT NULL,
                    "answer" text NOT NULL,
                    "category" varchar NOT NULL DEFAULT 'general',
                    "locale" varchar NOT NULL DEFAULT 'en',
                    "order" int NOT NULL DEFAULT 0,
                    "isPublished" boolean NOT NULL DEFAULT true,
                    "createdAt" timestamp NOT NULL DEFAULT now(),
                    "updatedAt" timestamp NOT NULL DEFAULT now()
                )
            `);
            await queryRunner.query(`CREATE INDEX "IDX_faqs_category_locale" ON "faqs" ("category", "locale")`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Revert support tickets
        await queryRunner.query(`ALTER TABLE "support_tickets" DROP COLUMN IF EXISTS "contactEmail"`);
        await queryRunner.query(`ALTER TABLE "support_tickets" ALTER COLUMN "userId" SET NOT NULL`);

        // Revert user balances
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "boostsBalance"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "complimentsBalance"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "likesBalance"`);

        // Revert purchase_transactions
        await queryRunner.query(`DROP TABLE IF EXISTS "purchase_transactions"`);

        // Revert consumable_products
        await queryRunner.query(`DROP TABLE IF EXISTS "consumable_products"`);

        // Revert faqs
        await queryRunner.query(`DROP TABLE IF EXISTS "faqs"`);
    }
}

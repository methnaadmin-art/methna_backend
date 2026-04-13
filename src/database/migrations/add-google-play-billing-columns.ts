import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGooglePlayBillingColumns1710000000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add googleProductId column to plans table
        await queryRunner.query(`
            ALTER TABLE "plans"
            ADD COLUMN IF NOT EXISTS "googleProductId" character varying NULL;
        `);

        // Create index on googleProductId for fast lookups
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_plans_googleProductId"
            ON "plans" ("googleProductId");
        `);

        // Create purchase_transactions table
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "purchase_transactions" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "userId" character varying NOT NULL,
                "planId" uuid NULL,
                "provider" character varying NOT NULL,
                "purchaseToken" character varying NULL,
                "productId" character varying NULL,
                "orderId" character varying NULL,
                "status" character varying NOT NULL DEFAULT 'pending',
                "rawVerification" jsonb NOT NULL DEFAULT '{}',
                "transactionDate" timestamp NULL,
                "expiryDate" timestamp NULL,
                "paymentReference" character varying NULL,
                "createdAt" timestamp NOT NULL DEFAULT now(),
                "updatedAt" timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "PK_purchase_transactions" PRIMARY KEY ("id"),
                CONSTRAINT "FK_purchase_transactions_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_purchase_transactions_plan" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL
            );
        `);

        // Create indexes on purchase_transactions
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_purchase_transactions_userId"
            ON "purchase_transactions" ("userId");
        `);

        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "IDX_purchase_transactions_purchaseToken"
            ON "purchase_transactions" ("purchaseToken");
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_purchase_transactions_planId"
            ON "purchase_transactions" ("planId");
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "purchase_transactions"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_plans_googleProductId"`);
        await queryRunner.query(`ALTER TABLE "plans" DROP COLUMN IF EXISTS "googleProductId"`);
    }
}

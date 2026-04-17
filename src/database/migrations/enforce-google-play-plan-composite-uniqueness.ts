import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceGooglePlayPlanCompositeUniqueness1723400000000 implements MigrationInterface {
    name = 'EnforceGooglePlayPlanCompositeUniqueness1723400000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DO $$
            DECLARE constraint_name text;
            BEGIN
                FOR constraint_name IN
                    SELECT c.conname
                    FROM pg_constraint c
                    JOIN pg_class t ON t.oid = c.conrelid
                    JOIN pg_namespace n ON n.oid = t.relnamespace
                    WHERE n.nspname = current_schema()
                      AND t.relname = 'plans'
                      AND c.contype = 'u'
                      AND array_length(c.conkey, 1) = 1
                      AND EXISTS (
                          SELECT 1
                          FROM unnest(c.conkey) AS key(attnum)
                          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = key.attnum
                          WHERE a.attname IN ('googleProductId', 'googleBasePlanId')
                      )
                LOOP
                    EXECUTE format('ALTER TABLE "plans" DROP CONSTRAINT IF EXISTS %I', constraint_name);
                END LOOP;
            END
            $$;
        `);

        await queryRunner.query(`
            DO $$
            DECLARE index_name text;
            BEGIN
                FOR index_name IN
                    SELECT i.relname
                    FROM pg_index idx
                    JOIN pg_class t ON t.oid = idx.indrelid
                    JOIN pg_class i ON i.oid = idx.indexrelid
                    JOIN pg_namespace n ON n.oid = t.relnamespace
                    WHERE n.nspname = current_schema()
                      AND t.relname = 'plans'
                      AND idx.indisunique = true
                      AND idx.indnatts = 1
                      AND EXISTS (
                          SELECT 1
                          FROM unnest(idx.indkey) AS key(attnum)
                          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = key.attnum
                          WHERE a.attname IN ('googleProductId', 'googleBasePlanId')
                      )
                LOOP
                    EXECUTE format('DROP INDEX IF EXISTS %I', index_name);
                END LOOP;
            END
            $$;
        `);

        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_plans_googleProductId_googleBasePlanId"
            ON "plans" ("googleProductId", "googleBasePlanId")
            WHERE "googleProductId" IS NOT NULL AND "googleBasePlanId" IS NOT NULL;
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_plans_googleProductId"
            ON "plans" ("googleProductId");
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_plans_googleBasePlanId"
            ON "plans" ("googleBasePlanId");
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP INDEX IF EXISTS "UQ_plans_googleProductId_googleBasePlanId";
        `);
    }
}

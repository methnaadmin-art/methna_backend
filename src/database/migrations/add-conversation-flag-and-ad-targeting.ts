import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConversationFlagAndAdTargeting1713000000000 implements MigrationInterface {
    name = 'AddConversationFlagAndAdTargeting1713000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Conversation: add isFlagged and flagReason
        await queryRunner.query(`
            ALTER TABLE "conversations"
            ADD COLUMN IF NOT EXISTS "isFlagged" boolean NOT NULL DEFAULT false
        `);

        await queryRunner.query(`
            ALTER TABLE "conversations"
            ADD COLUMN IF NOT EXISTS "flagReason" character varying NULL
        `);

        // Ads: add targeting fields
        await queryRunner.query(`
            ALTER TABLE "ads"
            ADD COLUMN IF NOT EXISTS "targetCountry" character varying NULL
        `);

        await queryRunner.query(`
            ALTER TABLE "ads"
            ADD COLUMN IF NOT EXISTS "targetCity" character varying NULL
        `);

        await queryRunner.query(`
            ALTER TABLE "ads"
            ADD COLUMN IF NOT EXISTS "showEveryNUsers" integer NOT NULL DEFAULT 1
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "ads" DROP COLUMN IF EXISTS "showEveryNUsers"`);
        await queryRunner.query(`ALTER TABLE "ads" DROP COLUMN IF EXISTS "targetCity"`);
        await queryRunner.query(`ALTER TABLE "ads" DROP COLUMN IF EXISTS "targetCountry"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN IF EXISTS "flagReason"`);
        await queryRunner.query(`ALTER TABLE "conversations" DROP COLUMN IF EXISTS "isFlagged"`);
    }
}

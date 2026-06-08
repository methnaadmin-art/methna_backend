import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProfileVisibilityAudienceField1781010000000
    implements MigrationInterface
{
    name = 'AddProfileVisibilityAudienceField1781010000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "visibilityAudience" character varying DEFAULT 'everyone'`,
        );
    }

    public async down(): Promise<void> {
        // Intentionally no-op. This is a production runtime schema addition.
    }
}

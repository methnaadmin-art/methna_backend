import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProfileReasonToUseField1781000000000
    implements MigrationInterface
{
    name = 'AddProfileReasonToUseField1781000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "reasonToUseMethna" character varying(250) NULL`,
        );
    }

    public async down(): Promise<void> {
        // Intentionally no-op. This is a production runtime schema addition.
    }
}

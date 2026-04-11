import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionStatusEnumValues1714000000000 implements MigrationInterface {
    name = 'AddSubscriptionStatusEnumValues1714000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add missing enum values to subscriptions_status_enum
        await queryRunner.query(`
            ALTER TYPE "subscriptions_status_enum" ADD VALUE IF NOT EXISTS 'past_due'
        `);

        await queryRunner.query(`
            ALTER TYPE "subscriptions_status_enum" ADD VALUE IF NOT EXISTS 'trial'
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // PostgreSQL does not support removing enum values
        // This is a no-op for rollback
    }
}

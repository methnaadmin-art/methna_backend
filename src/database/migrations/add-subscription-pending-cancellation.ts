import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionPendingCancellation1745000000000 implements MigrationInterface {
    name = 'AddSubscriptionPendingCancellation1745000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add pending_cancellation enum value to subscriptions_status_enum.
        // This represents a subscription that the user has cancelled but still
        // has access until the endDate (industry standard for pro apps).
        await queryRunner.query(`
            ALTER TYPE "subscriptions_status_enum" ADD VALUE IF NOT EXISTS 'pending_cancellation'
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // PostgreSQL does not support removing enum values
        // This is a no-op for rollback
    }
}

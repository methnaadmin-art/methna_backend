import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionPaymentProvider1716001000000 implements MigrationInterface {
    name = 'AddSubscriptionPaymentProvider1716001000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "paymentProvider" character varying NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "subscriptions" DROP COLUMN IF EXISTS "paymentProvider"`);
    }
}
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPerformanceIndexes1710000000000 implements MigrationInterface {
    name = 'AddPerformanceIndexes1710000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // ─── LOCATION INDEXES ───────────────────────────────────
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_profiles_lat_lng" ON "profiles" ("latitude", "longitude") WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_profiles_city_country" ON "profiles" ("city", "country")`);

        // ─── MATCHING INDEXES ───────────────────────────────────
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_profiles_gender_religious" ON "profiles" ("gender", "religiousLevel")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_profiles_gender_dob" ON "profiles" ("gender", "dateOfBirth")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_profiles_completion" ON "profiles" ("profileCompletionPercentage") WHERE "profileCompletionPercentage" >= 60`);

        // ─── LIKES / SWIPES INDEXES ─────────────────────────────
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_likes_liker_created" ON "likes" ("likerId", "createdAt")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_likes_liked_islike" ON "likes" ("likedId", "isLike")`);

        // ─── MESSAGES INDEXES ───────────────────────────────────
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_messages_conv_created" ON "messages" ("conversationId", "createdAt")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_messages_sender_created" ON "messages" ("senderId", "createdAt")`);

        // ─── CONVERSATIONS INDEXES ──────────────────────────────
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_conversations_last_msg" ON "conversations" ("lastMessageAt" DESC) WHERE "isActive" = true`);

        // ─── ANALYTICS INDEXES ──────────────────────────────────
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_analytics_type_date" ON "analytics_events" ("eventType", "eventDate")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_analytics_user_date" ON "analytics_events" ("userId", "eventDate")`);

        // ─── CONTENT FLAGS INDEXES ──────────────────────────────
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_content_flags_status" ON "content_flags" ("status") WHERE "status" = 'pending'`);

        // ─── BOOSTS INDEXES ─────────────────────────────────────
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_boosts_active" ON "boosts" ("userId", "isActive", "expiresAt") WHERE "isActive" = true`);

        // ─── USER TRUST INDEXES ─────────────────────────────────
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_users_trust_score" ON "users" ("trustScore") WHERE "isShadowBanned" = false`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_users_status_boosted" ON "users" ("status", "boostedUntil")`);

        // ─── LOGIN HISTORY INDEXES ──────────────────────────────
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_login_history_user_created" ON "login_history" ("userId", "createdAt")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_login_history_ip" ON "login_history" ("ipAddress", "createdAt")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_profiles_lat_lng"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_profiles_city_country"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_profiles_gender_religious"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_profiles_gender_dob"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_profiles_completion"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_likes_liker_created"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_likes_liked_islike"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_conv_created"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_messages_sender_created"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_conversations_last_msg"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_analytics_type_date"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_analytics_user_date"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_content_flags_status"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_boosts_active"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_trust_score"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_status_boosted"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_login_history_user_created"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_login_history_ip"`);
    }
}

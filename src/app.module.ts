import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './modules/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { PhotosModule } from './modules/photos/photos.module';
import { SwipesModule } from './modules/swipes/swipes.module';
import { MatchesModule } from './modules/matches/matches.module';
import { ChatModule } from './modules/chat/chat.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { SearchModule } from './modules/search/search.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AdminModule } from './modules/admin/admin.module';
import { MailModule } from './modules/mail/mail.module';
import { TrustSafetyModule } from './modules/trust-safety/trust-safety.module';
import { MatchingModule } from './modules/matching/matching.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { MonetizationModule } from './modules/monetization/monetization.module';
import { SecurityModule } from './modules/security/security.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { ProfileViewsModule } from './modules/profile-views/profile-views.module';
import { SuccessStoriesModule } from './modules/success-stories/success-stories.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PlansModule } from './modules/plans/plans.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { SupportModule } from './modules/support/support.module';
import { DailyInsightsModule } from './modules/daily-insights/daily-insights.module';
import { ContentModule } from './modules/content/content.module';
import { ModerationModule } from './common/moderation.module';
import { AdsModule } from './modules/ads/ads.module';
import { MobileModule } from './modules/mobile/mobile.module';
import { WebModule } from './modules/web/web.module';
import { ConsumablesModule } from './modules/consumables/consumable.module';
import configuration from './config/configuration';

@Module({
    imports: [
        // Environment configuration
        ConfigModule.forRoot({
            isGlobal: true,
            load: [configuration],
        }),

        // Rate limiting
        ThrottlerModule.forRoot([{
            ttl: parseInt(process.env.THROTTLE_TTL || '60', 10) * 1000,
            limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
        }]),

        // Database
        DatabaseModule,

        // Redis
        RedisModule,

        // Global modules
        MailModule,

        // Feature modules
        AuthModule,
        UsersModule,
        ProfilesModule,
        PhotosModule,
        SwipesModule,
        MatchesModule,
        ChatModule,
        NotificationsModule,
        SubscriptionsModule,
        SearchModule,
        ReportsModule,
        AdminModule,

        // Advanced feature modules
        TrustSafetyModule,
        MatchingModule,
        AnalyticsModule,
        MonetizationModule,
        SecurityModule,
        JobsModule,
        ProfileViewsModule,
        SuccessStoriesModule,
        PaymentsModule,
        PlansModule,
        CategoriesModule,
        SupportModule,
        DailyInsightsModule,
        ContentModule,
        ModerationModule,
        AdsModule,

        // Consumable purchases (likes/compliments/boosts packs)
        ConsumablesModule,

        // Platform-specific API surfaces
        MobileModule,   // /mobile/* — Google Play Billing only
        WebModule,      // /web/*    — Stripe only + /webhook/stripe
    ],
})
export class AppModule { }

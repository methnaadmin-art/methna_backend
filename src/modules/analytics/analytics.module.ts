import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsEvent } from '../../database/entities/analytics-event.entity';
import { User } from '../../database/entities/user.entity';
import { Match } from '../../database/entities/match.entity';
import { Like } from '../../database/entities/like.entity';
import { Message } from '../../database/entities/message.entity';
import { Subscription } from '../../database/entities/subscription.entity';
import { RedisModule } from '../redis/redis.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([AnalyticsEvent, User, Match, Like, Message, Subscription]),
        RedisModule,
    ],
    controllers: [AnalyticsController],
    providers: [AnalyticsService],
    exports: [AnalyticsService],
})
export class AnalyticsModule { }

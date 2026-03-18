import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobsService } from './jobs.service';
import { User } from '../../database/entities/user.entity';
import { UserBehavior } from '../../database/entities/user-behavior.entity';
import { Boost } from '../../database/entities/boost.entity';
import { AnalyticsEvent } from '../../database/entities/analytics-event.entity';
import { Profile } from '../../database/entities/profile.entity';
import { Like } from '../../database/entities/like.entity';
import { Match } from '../../database/entities/match.entity';
import { RedisModule } from '../redis/redis.module';

@Module({
    imports: [
        ScheduleModule.forRoot(),
        TypeOrmModule.forFeature([User, UserBehavior, Boost, AnalyticsEvent, Profile, Like, Match]),
        RedisModule,
    ],
    providers: [JobsService],
    exports: [JobsService],
})
export class JobsModule { }

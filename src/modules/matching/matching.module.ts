import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MatchingService } from './matching.service';
import { MatchingController } from './matching.controller';
import { User } from '../../database/entities/user.entity';
import { Profile } from '../../database/entities/profile.entity';
import { Like } from '../../database/entities/like.entity';
import { Match } from '../../database/entities/match.entity';
import { UserBehavior } from '../../database/entities/user-behavior.entity';
import { UserPreference } from '../../database/entities/user-preference.entity';
import { Photo } from '../../database/entities/photo.entity';
import { BlockedUser } from '../../database/entities/blocked-user.entity';
import { RedisModule } from '../redis/redis.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([User, Profile, Like, Match, UserBehavior, UserPreference, Photo, BlockedUser]),
        RedisModule,
    ],
    controllers: [MatchingController],
    providers: [MatchingService],
    exports: [MatchingService],
})
export class MatchingModule { }

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrustSafetyService } from './trust-safety.service';
import { TrustSafetyController } from './trust-safety.controller';
import { User } from '../../database/entities/user.entity';
import { Profile } from '../../database/entities/profile.entity';
import { Like } from '../../database/entities/like.entity';
import { Message } from '../../database/entities/message.entity';
import { ContentFlag } from '../../database/entities/content-flag.entity';
import { LoginHistory } from '../../database/entities/login-history.entity';
import { RedisModule } from '../redis/redis.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([User, Profile, Like, Message, ContentFlag, LoginHistory]),
        RedisModule,
    ],
    controllers: [TrustSafetyController],
    providers: [TrustSafetyService],
    exports: [TrustSafetyService],
})
export class TrustSafetyModule { }

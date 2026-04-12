import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ad } from '../../database/entities/ad.entity';
import { Profile } from '../../database/entities/profile.entity';
import { AdsController } from './ads.controller';
import { AdsService } from './ads.service';
import { RedisModule } from '../redis/redis.module';
import { PlansModule } from '../plans/plans.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Ad, Profile]),
        RedisModule,
        PlansModule,
    ],
    controllers: [AdsController],
    providers: [AdsService],
    exports: [AdsService],
})
export class AdsModule {}

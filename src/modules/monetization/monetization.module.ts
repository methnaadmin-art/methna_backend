import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MonetizationService } from './monetization.service';
import { MonetizationController } from './monetization.controller';
import { User } from '../../database/entities/user.entity';
import { Subscription } from '../../database/entities/subscription.entity';
import { Boost } from '../../database/entities/boost.entity';
import { RedisModule } from '../redis/redis.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([User, Subscription, Boost]),
        RedisModule,
    ],
    controllers: [MonetizationController],
    providers: [MonetizationService],
    exports: [MonetizationService],
})
export class MonetizationModule { }

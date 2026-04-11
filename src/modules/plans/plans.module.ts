import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Plan } from '../../database/entities/plan.entity';
import { Subscription } from '../../database/entities/subscription.entity';
import { User } from '../../database/entities/user.entity';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { RedisModule } from '../redis/redis.module';
import { RequireFeatureGuard } from '../../common/guards/require-feature.guard';

@Global()
@Module({
    imports: [
        TypeOrmModule.forFeature([Plan, Subscription, User]),
        RedisModule,
    ],
    controllers: [PlansController],
    providers: [PlansService, RequireFeatureGuard],
    exports: [PlansService, RequireFeatureGuard],
})
export class PlansModule { }

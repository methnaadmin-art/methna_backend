import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';
import { Subscription } from '../../database/entities/subscription.entity';
import { Plan } from '../../database/entities/plan.entity';
import { User } from '../../database/entities/user.entity';

@Module({
    imports: [TypeOrmModule.forFeature([Subscription, Plan, User])],
    controllers: [SubscriptionsController],
    providers: [SubscriptionsService],
    exports: [SubscriptionsService],
})
export class SubscriptionsModule { }

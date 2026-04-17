import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Subscription } from '../../database/entities/subscription.entity';
import { Plan } from '../../database/entities/plan.entity';
import { User } from '../../database/entities/user.entity';
import { PurchaseTransaction } from '../../database/entities/purchase-transaction.entity';
import { ConsumableProduct } from '../../database/entities/consumable-product.entity';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { GooglePlayBillingService } from './google-play-billing.service';
import { GooglePlayBillingController } from './google-play-billing.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { RedisModule } from '../redis/redis.module';
import { ConsumablesModule } from '../consumables/consumable.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Subscription, Plan, User, PurchaseTransaction, ConsumableProduct]),
        ConfigModule,
        SubscriptionsModule,
        RedisModule,
        ConsumablesModule,
    ],
    controllers: [PaymentsController, GooglePlayBillingController],
    providers: [PaymentsService, GooglePlayBillingService],
    exports: [PaymentsService, GooglePlayBillingService],
})
export class PaymentsModule { }

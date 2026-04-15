import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { WebController } from './web.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { StripeService } from './stripe.service';
import { Plan } from '../../database/entities/plan.entity';
import { ConsumableProduct } from '../../database/entities/consumable-product.entity';
import { Subscription } from '../../database/entities/subscription.entity';
import { PurchaseTransaction } from '../../database/entities/purchase-transaction.entity';
import { User } from '../../database/entities/user.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ConsumablesModule } from '../consumables/consumable.module';

/**
 * Web API module.
 *
 * Exposes Stripe-only endpoints at /web/* and /webhook/stripe.
 * Depends on PlansModule (global), SubscriptionsModule, and its own StripeService.
 */
@Module({
    imports: [
        TypeOrmModule.forFeature([Plan, ConsumableProduct, Subscription, PurchaseTransaction, User]),
        ConfigModule,
        SubscriptionsModule,
        ConsumablesModule,
    ],
    controllers: [WebController, StripeWebhookController],
    providers: [StripeService],
    exports: [StripeService],
})
export class WebModule {}

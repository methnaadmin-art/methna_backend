import { Module } from '@nestjs/common';
import { MobileController } from './mobile.controller';
import { PlansModule } from '../plans/plans.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PaymentsModule } from '../payments/payments.module';
import { ConsumablesModule } from '../consumables/consumable.module';

/**
 * Mobile API module.
 *
 * Exposes Google-Play-only endpoints at /mobile/*.
 * Depends on PlansModule (global), SubscriptionsModule, PaymentsModule (for GooglePlayBillingService),
 * ConsumablesModule (for consumable product catalog and balance management).
 */
@Module({
    imports: [
        SubscriptionsModule,
        PaymentsModule,
        ConsumablesModule,
    ],
    controllers: [MobileController],
})
export class MobileModule {}

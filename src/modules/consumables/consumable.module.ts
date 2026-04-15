import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConsumableProduct } from '../../database/entities/consumable-product.entity';
import { PurchaseTransaction } from '../../database/entities/purchase-transaction.entity';
import { User } from '../../database/entities/user.entity';
import { Boost } from '../../database/entities/boost.entity';
import { ConsumableService } from './consumable.service';
import { ConsumableController } from './consumable.controller';
import { RedisModule } from '../redis/redis.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([ConsumableProduct, PurchaseTransaction, User, Boost]),
        RedisModule,
    ],
    controllers: [ConsumableController],
    providers: [ConsumableService],
    exports: [ConsumableService],
})
export class ConsumablesModule {}

import { Module, Global, Logger } from '@nestjs/common';
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
export class PlansModule {
    private readonly logger = new Logger(PlansModule.name);

    constructor(private readonly plansService: PlansService) {}

    async onModuleInit(): Promise<void> {
        try {
            await this.plansService.ensureFreePlanExists();
        } catch (err: any) {
            this.logger.warn(`Failed to ensure free plan exists: ${err?.message}`);
        }
    }
}

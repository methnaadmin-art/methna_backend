import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DailyInsight } from '../../database/entities/daily-insight.entity';
import { DailyInsightsService } from './daily-insights.service';
import { DailyInsightsController } from './daily-insights.controller';

@Module({
    imports: [TypeOrmModule.forFeature([DailyInsight])],
    controllers: [DailyInsightsController],
    providers: [DailyInsightsService],
    exports: [DailyInsightsService],
})
export class DailyInsightsModule { }

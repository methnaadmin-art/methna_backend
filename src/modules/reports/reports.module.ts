import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { Report } from '../../database/entities/report.entity';
import { BlockedUser } from '../../database/entities/blocked-user.entity';
import { Match } from '../../database/entities/match.entity';

@Module({
    imports: [TypeOrmModule.forFeature([Report, BlockedUser, Match])],
    controllers: [ReportsController],
    providers: [ReportsService],
    exports: [ReportsService],
})
export class ReportsModule { }

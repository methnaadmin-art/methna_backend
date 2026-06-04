import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { SupportTicket } from '../../database/entities/support-ticket.entity';
import { MonetizationModule } from '../monetization/monetization.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([SupportTicket]),
        NotificationsModule,
        MonetizationModule,
    ],
    controllers: [SupportController],
    providers: [SupportService],
    exports: [SupportService],
})
export class SupportModule { }

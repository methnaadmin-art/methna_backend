import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationGateway } from './notification.gateway';
import { Notification } from '../../database/entities/notification.entity';
import { User } from '../../database/entities/user.entity';
import { RedisModule } from '../redis/redis.module';
import { AuthModule } from '../auth/auth.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Notification, User]),
        RedisModule,
        AuthModule,
        ConfigModule,
    ],
    controllers: [NotificationsController],
    providers: [NotificationsService, NotificationGateway],
    exports: [NotificationsService, NotificationGateway],
})
export class NotificationsModule { }

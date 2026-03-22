import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { Message } from '../../database/entities/message.entity';
import { Match } from '../../database/entities/match.entity';
import { BlockedUser } from '../../database/entities/blocked-user.entity';
import { Conversation } from '../../database/entities/conversation.entity';
import { User } from '../../database/entities/user.entity';
import { Photo } from '../../database/entities/photo.entity';
import { RedisModule } from '../redis/redis.module';
import { TrustSafetyModule } from '../trust-safety/trust-safety.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Message, Match, Conversation, User, Photo, BlockedUser]),
        RedisModule,
        TrustSafetyModule,
        AuthModule,
        ConfigModule,
        NotificationsModule,
    ],
    controllers: [ChatController],
    providers: [ChatService, ChatGateway],
    exports: [ChatService],
})
export class ChatModule { }

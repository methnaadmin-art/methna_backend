import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from '../../database/entities/notification.entity';
import { RedisService } from '../redis/redis.service';

@WebSocketGateway({
    namespace: '/notifications',
    cors: {
        origin: process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== '*'
            ? process.env.CORS_ORIGIN.split(',')
            : true,
        credentials: true,
    },
})
export class NotificationGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(NotificationGateway.name);

    constructor(
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        private readonly redisService: RedisService,
        @InjectRepository(Notification)
        private readonly notificationRepo: Repository<Notification>,
    ) {}

    afterInit() {
        this.logger.log('NotificationGateway initialized');
    }

    async handleConnection(client: Socket) {
        try {
            const token = client.handshake.auth?.token as string;
            if (!token) {
                client.disconnect();
                return;
            }

            let payload: any;
            try {
                payload = this.jwtService.verify(token, {
                    secret: this.configService.get<string>('jwt.secret'),
                });
            } catch {
                client.disconnect();
                return;
            }

            const userId = payload.sub;
            if (!userId) {
                client.disconnect();
                return;
            }

            client.data.userId = userId;
            client.join(`user:${userId}`);
            this.logger.log(`Notification client connected: ${userId}`);

            // Deliver unread notifications on reconnect
            await this.deliverPending(client, userId);
        } catch (error) {
            this.logger.error(`Notification socket error: ${(error as Error).message}`);
            client.disconnect();
        }
    }

    handleDisconnect(client: Socket) {
        const userId = client.data?.userId;
        if (userId) {
            this.logger.log(`Notification client disconnected: ${userId}`);
        }
    }

    /**
     * Send a real-time notification to a specific user.
     * Called by NotificationsService after DB insert.
     */
    sendToUser(userId: string, notification: any): void {
        if (!this.server) return;
        this.server.to(`user:${userId}`).emit('notification', notification);
        this.logger.debug(`Emitted notification to user:${userId} — ${notification.title}`);
    }

    /**
     * Deliver all unread notifications when user reconnects.
     */
    private async deliverPending(client: Socket, userId: string): Promise<void> {
        try {
            const unread = await this.notificationRepo.find({
                where: { userId, isRead: false },
                order: { createdAt: 'DESC' },
                take: 50,
            });

            if (unread.length > 0) {
                client.emit('pendingNotifications', unread);
                this.logger.debug(`Delivered ${unread.length} pending notifications to ${userId}`);
            }
        } catch (error) {
            this.logger.error(`Failed to deliver pending notifications: ${(error as Error).message}`);
        }
    }
}

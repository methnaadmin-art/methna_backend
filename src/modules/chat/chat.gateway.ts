import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    ConnectedSocket,
    MessageBody,
} from '@nestjs/websockets';
import { Logger, Inject, Optional, forwardRef } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { ChatService } from './chat.service';
import { RedisService } from '../redis/redis.service';
import { TrustSafetyService } from '../trust-safety/trust-safety.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MessageType } from '../../database/entities/message.entity';

@WebSocketGateway({
    cors: {
        origin: process.env.CORS_ORIGIN && process.env.CORS_ORIGIN !== '*'
            ? process.env.CORS_ORIGIN.split(',')
            : true,
        credentials: true,
    },
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(ChatGateway.name);

    constructor(
        @Inject(forwardRef(() => ChatService))
        private readonly chatService: ChatService,
        private readonly redisService: RedisService,
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        private readonly notificationsService: NotificationsService,
        @Optional() @Inject(TrustSafetyService)
        private readonly trustSafetyService?: TrustSafetyService,
    ) { }

    afterInit(server: Server) {
        this.logger.log('Socket.IO running in single-instance mode (in-memory)');
    }

    async handleConnection(client: Socket) {
        try {
            const token = client.handshake.auth?.token as string;
            if (!token) {
                this.logger.warn('Socket connection rejected: no token provided');
                client.emit('error', { message: 'Authentication required' });
                client.disconnect();
                return;
            }

            let payload: any;
            try {
                payload = this.jwtService.verify(token, {
                    secret: this.configService.get<string>('jwt.secret'),
                });
            } catch (jwtError) {
                this.logger.warn(`Socket connection rejected: invalid token — ${(jwtError as Error).message}`);
                client.emit('error', { message: 'Invalid or expired token' });
                client.disconnect();
                return;
            }

            const userId = payload.sub;
            if (!userId) {
                this.logger.warn('Socket connection rejected: token has no sub claim');
                client.disconnect();
                return;
            }

            client.data.userId = userId;
            await this.redisService.setUserOnline(userId);
            client.join(`user:${userId}`);

            this.logger.log(`Client connected (JWT verified): ${userId}`);
            this.server.to(`user:${userId}`).emit('userOnline', { userId, timestamp: new Date() });
        } catch (error) {
            this.logger.error(`Socket connection error: ${(error as Error).message}`);
            client.disconnect();
        }
    }

    async handleDisconnect(client: Socket) {
        const userId = client.data?.userId;
        if (userId) {
            await this.redisService.setUserOffline(userId);
            await this.redisService.set(`lastSeen:${userId}`, new Date().toISOString(), 86400 * 30);
            this.server.to(`user:${userId}`).emit('userOffline', { userId, lastSeen: new Date() });
            this.logger.log(`Client disconnected: ${userId}`);
        }
    }

    @SubscribeMessage('joinConversation')
    async handleJoinConversation(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: { conversationId: string },
    ) {
        const userId = client.data.userId;
        try {
            await this.chatService.getMessages(userId, payload.conversationId, { page: 1, limit: 1 } as any);
        } catch {
            this.logger.warn(`User ${userId} tried to join conversation ${payload.conversationId} they don't belong to`);
            return { success: false, error: 'Not a participant of this conversation' };
        }

        client.join(`conversation:${payload.conversationId}`);
        try {
            await this.chatService.markAsDelivered(userId, payload.conversationId);
            client.to(`conversation:${payload.conversationId}`).emit('messagesDelivered', {
                conversationId: payload.conversationId,
                deliveredTo: userId,
            });
        } catch { }

        return { success: true };
    }

    @SubscribeMessage('leaveConversation')
    async handleLeaveConversation(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: { conversationId: string },
    ) {
        client.leave(`conversation:${payload.conversationId}`);
        return { success: true };
    }

    @SubscribeMessage('sendMessage')
    async handleSendMessage(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: { conversationId: string; content: string; type?: string; imageUrl?: string; clientMsgId?: string },
    ) {
        const senderId = client.data.userId;
        const { conversationId, content, type, imageUrl, clientMsgId } = payload;

        try {
            const msgType = MessageType.TEXT;
            let msgContent = content;

            let flagged = false;
            if (msgType === MessageType.TEXT && this.trustSafetyService) {
                const moderation = await this.trustSafetyService.moderateMessage(senderId, '', msgContent);
                if (!moderation.isClean) {
                    msgContent = moderation.cleanContent;
                    flagged = true;
                }
            }

            const message = await this.chatService.sendMessage(
                senderId,
                conversationId,
                msgContent,
                msgType,
                clientMsgId,
            );

            return { success: true, messageId: message.id, flagged, clientMsgId };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }

    async broadcastMessage(message: any, clientMsgId?: string) {
        const { conversationId, senderId } = message;

        // Emit to the conversation room (for active chat UI)
        this.server.to(`conversation:${conversationId}`).emit('newMessage', {
            id: message.id,
            conversationId: message.conversationId,
            senderId: message.senderId,
            content: message.content,
            type: message.type,
            status: message.status,
            createdAt: message.createdAt,
            clientMsgId,
        });

        // Also emit to individual user rooms (for notifications or background updates)
        const participants = await this.chatService.getConversationParticipants(conversationId);
        if (participants) {
            const recipientId = participants.find(id => id !== senderId);
            if (recipientId) {
                this.server.to(`user:${recipientId}`).emit('newMessage', {
                    id: message.id,
                    conversationId: message.conversationId,
                    senderId: message.senderId,
                    content: message.content,
                    type: message.type,
                    status: message.status,
                    createdAt: message.createdAt,
                    clientMsgId,
                });
            }
        }

        // Send push notification if they are offline/not in room
        this.sendMessageNotification(senderId, conversationId, message.content).catch(() => {});
    }

    private async sendMessageNotification(senderId: string, conversationId: string, content: string): Promise<void> {
        try {
            const room = this.server.in(`conversation:${conversationId}`);
            const sockets = await room.fetchSockets();
            const connectedUserIds = sockets.map(s => s.data?.userId).filter(Boolean);

            const conversation = await this.chatService.getConversationParticipants(conversationId);
            if (!conversation) return;

            const recipientIds = conversation.filter(id => id !== senderId && !connectedUserIds.includes(id));

            for (const recipientId of recipientIds) {
                this.notificationsService.createNotification(recipientId, {
                    type: 'message',
                    userId: senderId,
                    conversationId,
                    title: 'New message',
                    body: content.length > 80 ? content.substring(0, 80) + '...' : content,
                    extraData: { senderId },
                }).catch(() => {});
            }
        } catch (error) {
            this.logger.error(`Failed to send message notification: ${(error as Error).message}`);
        }
    }

    @SubscribeMessage('typing')
    async handleTyping(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: { conversationId: string },
    ) {
        const senderId = client.data.userId;
        client.to(`conversation:${payload.conversationId}`).emit('typing', {
            conversationId: payload.conversationId,
            userId: senderId,
        });
    }

    @SubscribeMessage('stopTyping')
    async handleStopTyping(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: { conversationId: string },
    ) {
        const senderId = client.data.userId;
        client.to(`conversation:${payload.conversationId}`).emit('userStoppedTyping', {
            conversationId: payload.conversationId,
            userId: senderId,
        });
    }

    @SubscribeMessage('markRead')
    async handleMarkRead(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: { conversationId: string },
    ) {
        const userId = client.data.userId;
        try {
            await this.chatService.markAsRead(userId, payload.conversationId);
            const readPayload = {
                conversationId: payload.conversationId,
                readBy: userId,
                readAt: new Date(),
            };
            client.to(`conversation:${payload.conversationId}`).emit('messagesRead', readPayload);
            return { success: true };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }

    @SubscribeMessage('markDelivered')
    async handleMarkDelivered(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: { conversationId: string },
    ) {
        const userId = client.data.userId;
        try {
            await this.chatService.markAsDelivered(userId, payload.conversationId);
            client.to(`conversation:${payload.conversationId}`).emit('messagesDelivered', {
                conversationId: payload.conversationId,
                deliveredTo: userId,
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }

    @SubscribeMessage('checkOnline')
    async handleCheckOnline(
        @MessageBody() payload: { userId: string },
    ) {
        const isOnline = await this.redisService.isUserOnline(payload.userId);
        let lastSeen: string | null = null;
        if (!isOnline) {
            lastSeen = await this.redisService.get(`lastSeen:${payload.userId}`);
        }
        return { userId: payload.userId, online: isOnline, lastSeen };
    }
}

import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    ConnectedSocket,
    MessageBody,
} from '@nestjs/websockets';
import { Logger, Inject, Optional } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { RedisService } from '../redis/redis.service';
import { TrustSafetyService } from '../trust-safety/trust-safety.service';
import { MessageType } from '../../database/entities/message.entity';

@WebSocketGateway({
    cors: { origin: '*' },
    namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(ChatGateway.name);

    constructor(
        private readonly chatService: ChatService,
        private readonly redisService: RedisService,
        @Optional() @Inject(TrustSafetyService)
        private readonly trustSafetyService?: TrustSafetyService,
    ) { }

    // ─── CONNECTION LIFECYCLE ───────────────────────────────

    async handleConnection(client: Socket) {
        try {
            const userId = client.handshake.query.userId as string;
            if (!userId) {
                client.disconnect();
                return;
            }

            client.data.userId = userId;
            await this.redisService.setUserOnline(userId);
            client.join(`user:${userId}`);

            this.logger.log(`Client connected: ${userId}`);
            this.server.emit('userOnline', { userId, timestamp: new Date() });
        } catch (error) {
            client.disconnect();
        }
    }

    async handleDisconnect(client: Socket) {
        const userId = client.data?.userId;
        if (userId) {
            await this.redisService.setUserOffline(userId);
            // Store last seen timestamp
            await this.redisService.set(`lastSeen:${userId}`, new Date().toISOString(), 86400 * 30);
            this.server.emit('userOffline', { userId, lastSeen: new Date() });
            this.logger.log(`Client disconnected: ${userId}`);
        }
    }

    // ─── CONVERSATION ROOMS ─────────────────────────────────

    @SubscribeMessage('joinConversation')
    async handleJoinConversation(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: { conversationId: string },
    ) {
        client.join(`conversation:${payload.conversationId}`);

        // Auto-mark messages as delivered when joining
        const userId = client.data.userId;
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

    // ─── SEND MESSAGE ───────────────────────────────────────

    @SubscribeMessage('sendMessage')
    async handleSendMessage(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: { conversationId: string; content: string; type?: string; imageUrl?: string },
    ) {
        const senderId = client.data.userId;
        const { conversationId, content, type, imageUrl } = payload;

        try {
            // Determine message type
            let msgType = MessageType.TEXT;
            let msgContent = content;

            if (type === 'image' || imageUrl) {
                msgType = MessageType.IMAGE;
                msgContent = imageUrl || content;
            }

            // Content moderation for text messages
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
            );

            // If flagged, run async moderation update with the actual message ID
            if (flagged && this.trustSafetyService) {
                // Re-flag with proper entity ID (fire-and-forget)
                this.trustSafetyService.moderateMessage(senderId, message.id, content).catch(() => {});
            }

            // Emit to the conversation room
            this.server.to(`conversation:${conversationId}`).emit('newMessage', {
                id: message.id,
                conversationId: message.conversationId,
                senderId: message.senderId,
                content: message.content,
                type: message.type,
                status: message.status,
                createdAt: message.createdAt,
                flagged,
            });

            return { success: true, messageId: message.id, flagged };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }

    // ─── TYPING INDICATORS ──────────────────────────────────

    @SubscribeMessage('typing')
    async handleTyping(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: { conversationId: string },
    ) {
        const senderId = client.data.userId;
        client.to(`conversation:${payload.conversationId}`).emit('userTyping', {
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

    // ─── MESSAGE STATUS ─────────────────────────────────────

    @SubscribeMessage('markRead')
    async handleMarkRead(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: { conversationId: string },
    ) {
        const userId = client.data.userId;
        try {
            await this.chatService.markAsRead(userId, payload.conversationId);
            client.to(`conversation:${payload.conversationId}`).emit('messagesRead', {
                conversationId: payload.conversationId,
                readBy: userId,
                readAt: new Date(),
            });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
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
            return { success: false, error: error.message };
        }
    }

    // ─── PRESENCE ───────────────────────────────────────────

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

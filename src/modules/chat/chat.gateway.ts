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
import { Logger, Inject, Optional } from '@nestjs/common';
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
        private readonly chatService: ChatService,
        private readonly redisService: RedisService,
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        private readonly notificationsService: NotificationsService,
        @Optional() @Inject(TrustSafetyService)
        private readonly trustSafetyService?: TrustSafetyService,
    ) { }

    // ─── REDIS ADAPTER FOR HORIZONTAL SCALING ────────────────

    afterInit(server: Server) {
        this.logger.log('Socket.IO running in single-instance mode (in-memory)');
    }

    // ─── CONNECTION LIFECYCLE ───────────────────────────────

    async handleConnection(client: Socket) {
        try {
            // Extract JWT from auth object (sent by Flutter client)
            const token = client.handshake.auth?.token as string;
            if (!token) {
                this.logger.warn('Socket connection rejected: no token provided');
                client.emit('error', { message: 'Authentication required' });
                client.disconnect();
                return;
            }

            // Verify the JWT and extract userId from payload
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

            // Check if token is blacklisted (logout / session revocation)
            if (payload.jti) {
                const isBlacklisted = await this.redisService.isTokenBlacklisted(payload.jti);
                if (isBlacklisted) {
                    this.logger.warn(`Socket connection rejected: token ${payload.jti} is blacklisted`);
                    client.emit('error', { message: 'Token has been revoked' });
                    client.disconnect();
                    return;
                }
            }

            // Check global session revocation
            const revokedAt = await this.redisService.getUserRevokedAt(userId);
            if (revokedAt && payload.iat && payload.iat * 1000 < revokedAt) {
                this.logger.warn(`Socket rejected: token issued before session revocation for ${userId}`);
                client.emit('error', { message: 'Session has been revoked. Please re-login.' });
                client.disconnect();
                return;
            }

            client.data.userId = userId;
            await this.redisService.setUserOnline(userId);
            client.join(`user:${userId}`);

            this.logger.log(`Client connected (JWT verified): ${userId}`);
            // Emit presence only to user's own room (privacy — not broadcast to all)
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
            // Store last seen timestamp
            await this.redisService.set(`lastSeen:${userId}`, new Date().toISOString(), 86400 * 30);
            this.server.to(`user:${userId}`).emit('userOffline', { userId, lastSeen: new Date() });
            this.logger.log(`Client disconnected: ${userId}`);
        }
    }

    // ─── CONVERSATION ROOMS ─────────────────────────────────

    @SubscribeMessage('joinConversation')
    async handleJoinConversation(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: { conversationId: string },
    ) {
        const userId = client.data.userId;

        // Verify the user is actually a participant in this conversation
        try {
            await this.chatService.getMessages(userId, payload.conversationId, { page: 1, limit: 1 } as any);
        } catch {
            this.logger.warn(`User ${userId} tried to join conversation ${payload.conversationId} they don't belong to`);
            return { success: false, error: 'Not a participant of this conversation' };
        }

        client.join(`conversation:${payload.conversationId}`);

        // Auto-mark messages as delivered when joining
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

            // Send notification to the other participant if they are offline
            this.sendMessageNotification(senderId, conversationId, message.content).catch(() => {});

            return { success: true, messageId: message.id, flagged };
        } catch (error) {
            return { success: false, error: (error as Error).message };
        }
    }

    /**
     * Check if the recipient is in the conversation room; if not, send a DB notification.
     */
    private async sendMessageNotification(senderId: string, conversationId: string, content: string): Promise<void> {
        try {
            // Get sockets in the conversation room
            const room = this.server.in(`conversation:${conversationId}`);
            const sockets = await room.fetchSockets();
            const connectedUserIds = sockets.map(s => s.data?.userId).filter(Boolean);

            // Find the other participant(s) not currently in the room
            // We need to look up the conversation to find the other user
            const conversation = await this.chatService.getConversationParticipants(conversationId);
            if (!conversation) return;

            const recipientIds = conversation.filter(id => id !== senderId && !connectedUserIds.includes(id));

            for (const recipientId of recipientIds) {
                // Check if user is online at all (connected to the main namespace)
                const isOnline = await this.redisService.isUserOnline(recipientId);
                // Always store notification for offline users or users not in the conversation room
                this.notificationsService.createNotification(recipientId, {
                    type: 'message',
                    title: 'New message',
                    body: content.length > 80 ? content.substring(0, 80) + '...' : content,
                    data: { conversationId, senderId },
                }).catch(() => {});
            }
        } catch (error) {
            this.logger.error(`Failed to send message notification: ${(error as Error).message}`);
        }
    }

    // ─── TYPING INDICATORS ──────────────────────────────────

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

    // ─── MESSAGE STATUS ─────────────────────────────────────

    @SubscribeMessage('markRead')
    async handleMarkRead(
        @ConnectedSocket() client: Socket,
        @MessageBody() payload: { conversationId: string },
    ) {
        const userId = client.data.userId;
        try {
            await this.chatService.markAsRead(userId, payload.conversationId);
            // Emit both event names for backward compatibility
            const readPayload = {
                conversationId: payload.conversationId,
                readBy: userId,
                readAt: new Date(),
            };
            client.to(`conversation:${payload.conversationId}`).emit('messagesRead', readPayload);
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

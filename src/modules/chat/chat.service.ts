import {
    Injectable,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message, MessageType, MessageStatus } from '../../database/entities/message.entity';
import { Match, MatchStatus } from '../../database/entities/match.entity';
import { Conversation } from '../../database/entities/conversation.entity';
import { Photo } from '../../database/entities/photo.entity';
import { PaginationDto } from '../../common/dto/pagination.dto';

@Injectable()
export class ChatService {
    constructor(
        @InjectRepository(Message)
        private readonly messageRepository: Repository<Message>,
        @InjectRepository(Match)
        private readonly matchRepository: Repository<Match>,
        @InjectRepository(Conversation)
        private readonly conversationRepository: Repository<Conversation>,
        @InjectRepository(Photo)
        private readonly photoRepository: Repository<Photo>,
    ) { }

    // ─── CONVERSATIONS LIST ─────────────────────────────────

    async getConversations(userId: string, pagination: PaginationDto) {
        const [conversations, total] = await this.conversationRepository.findAndCount({
            where: [
                { user1Id: userId, isActive: true },
                { user2Id: userId, isActive: true },
            ],
            relations: ['user1', 'user2'],
            order: { lastMessageAt: 'DESC' },
            skip: pagination.skip,
            take: pagination.limit,
        });

        const enriched = await Promise.all(
            conversations.map(async (conv) => {
                const otherUserId = conv.user1Id === userId ? conv.user2Id : conv.user1Id;
                const otherUser = conv.user1Id === userId ? conv.user2 : conv.user1;
                const unreadCount = conv.user1Id === userId ? conv.user1UnreadCount : conv.user2UnreadCount;
                const isMuted = conv.user1Id === userId ? conv.user1Muted : conv.user2Muted;

                const photo = await this.photoRepository.findOne({
                    where: { userId: otherUserId, isMain: true },
                });

                return {
                    id: conv.id,
                    matchId: conv.matchId,
                    otherUser: {
                        id: otherUserId,
                        firstName: otherUser?.firstName,
                        lastName: otherUser?.lastName,
                        photo: photo?.url || null,
                    },
                    lastMessage: conv.lastMessageContent,
                    lastMessageAt: conv.lastMessageAt,
                    lastMessageSenderId: conv.lastMessageSenderId,
                    unreadCount,
                    isMuted,
                };
            }),
        );

        return { conversations: enriched, total, page: pagination.page, limit: pagination.limit };
    }

    // ─── MESSAGES ───────────────────────────────────────────

    async getMessages(userId: string, conversationId: string, pagination: PaginationDto) {
        const conversation = await this.verifyConversationParticipant(userId, conversationId);

        const [messages, total] = await this.messageRepository.findAndCount({
            where: { conversationId },
            order: { createdAt: 'DESC' },
            skip: pagination.skip,
            take: pagination.limit,
            relations: ['sender'],
        });

        return {
            messages: messages.reverse(),
            total,
            page: pagination.page,
            limit: pagination.limit,
        };
    }

    async sendMessage(
        senderId: string,
        conversationId: string,
        content: string,
        type: MessageType = MessageType.TEXT,
    ): Promise<Message> {
        const conversation = await this.verifyConversationParticipant(senderId, conversationId);

        const message = this.messageRepository.create({
            conversationId,
            matchId: conversation.matchId,
            senderId,
            content,
            type,
            status: MessageStatus.SENT,
        });

        const saved = await this.messageRepository.save(message);

        // Update conversation metadata
        const isUser1 = conversation.user1Id === senderId;
        await this.conversationRepository.update(conversation.id, {
            lastMessageContent: content.substring(0, 200),
            lastMessageAt: new Date(),
            lastMessageSenderId: senderId,
            // Increment unread count for the other user
            ...(isUser1
                ? { user2UnreadCount: () => '"user2UnreadCount" + 1' }
                : { user1UnreadCount: () => '"user1UnreadCount" + 1' }),
        } as any);

        return saved;
    }

    // ─── MESSAGE STATUS ─────────────────────────────────────

    async markAsDelivered(userId: string, conversationId: string): Promise<void> {
        await this.verifyConversationParticipant(userId, conversationId);

        await this.messageRepository
            .createQueryBuilder()
            .update()
            .set({ status: MessageStatus.DELIVERED, deliveredAt: new Date() })
            .where('conversationId = :conversationId', { conversationId })
            .andWhere('senderId != :userId', { userId })
            .andWhere('status = :status', { status: MessageStatus.SENT })
            .execute();
    }

    async markAsRead(userId: string, conversationId: string): Promise<void> {
        const conversation = await this.verifyConversationParticipant(userId, conversationId);

        await this.messageRepository
            .createQueryBuilder()
            .update()
            .set({ status: MessageStatus.SEEN, readAt: new Date() })
            .where('conversationId = :conversationId', { conversationId })
            .andWhere('senderId != :userId', { userId })
            .andWhere('status != :seen', { seen: MessageStatus.SEEN })
            .execute();

        // Reset unread count
        const isUser1 = conversation.user1Id === userId;
        await this.conversationRepository.update(conversation.id, {
            ...(isUser1 ? { user1UnreadCount: 0 } : { user2UnreadCount: 0 }),
        });
    }

    // ─── MUTE ───────────────────────────────────────────────

    async muteConversation(userId: string, conversationId: string, muted: boolean): Promise<void> {
        const conversation = await this.verifyConversationParticipant(userId, conversationId);
        const isUser1 = conversation.user1Id === userId;

        await this.conversationRepository.update(conversation.id, {
            ...(isUser1 ? { user1Muted: muted } : { user2Muted: muted }),
        });
    }

    // ─── UNREAD COUNT ───────────────────────────────────────

    async getTotalUnreadCount(userId: string): Promise<number> {
        const conversations = await this.conversationRepository.find({
            where: [
                { user1Id: userId, isActive: true },
                { user2Id: userId, isActive: true },
            ],
        });

        return conversations.reduce((total, conv) => {
            const unread = conv.user1Id === userId ? conv.user1UnreadCount : conv.user2UnreadCount;
            return total + unread;
        }, 0);
    }

    // ─── HELPERS ────────────────────────────────────────────

    private async verifyConversationParticipant(
        userId: string,
        conversationId: string,
    ): Promise<Conversation> {
        const conversation = await this.conversationRepository.findOne({
            where: [
                { id: conversationId, user1Id: userId, isActive: true },
                { id: conversationId, user2Id: userId, isActive: true },
            ],
        });

        if (!conversation) {
            throw new ForbiddenException('You are not part of this conversation');
        }
        return conversation;
    }
}

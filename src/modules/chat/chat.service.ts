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
import { BlockedUser } from '../../database/entities/blocked-user.entity';
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
        @InjectRepository(BlockedUser)
        private readonly blockedUserRepository: Repository<BlockedUser>,
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

        // Batch fetch photos for all other users (avoids N+1)
        const otherUserIds = conversations.map(c =>
            c.user1Id === userId ? c.user2Id : c.user1Id,
        );
        const photos = otherUserIds.length > 0
            ? await this.photoRepository
                .createQueryBuilder('photo')
                .where('photo.userId IN (:...otherUserIds)', { otherUserIds })
                .andWhere('photo.isMain = :isMain', { isMain: true })
                .getMany()
            : [];
        const photoMap = new Map(photos.map(p => [p.userId, p.url]));

        const enriched = conversations.map((conv) => {
            const otherUserId = conv.user1Id === userId ? conv.user2Id : conv.user1Id;
            const otherUser = conv.user1Id === userId ? conv.user2 : conv.user1;
            const unreadCount = conv.user1Id === userId ? conv.user1UnreadCount : conv.user2UnreadCount;
            const isMuted = conv.user1Id === userId ? conv.user1Muted : conv.user2Muted;

            return {
                id: conv.id,
                matchId: conv.matchId,
                otherUser: {
                    id: otherUserId,
                    firstName: otherUser?.firstName,
                    lastName: otherUser?.lastName,
                    photo: photoMap.get(otherUserId) || null,
                },
                lastMessage: conv.lastMessageContent,
                lastMessageAt: conv.lastMessageAt,
                lastMessageSenderId: conv.lastMessageSenderId,
                unreadCount,
                isMuted,
            };
        });

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

        // Check if either user has blocked the other
        const recipientId = conversation.user1Id === senderId ? conversation.user2Id : conversation.user1Id;
        const isBlocked = await this.blockedUserRepository.findOne({
            where: [
                { blockerId: senderId, blockedId: recipientId },
                { blockerId: recipientId, blockedId: senderId },
            ],
        });
        if (isBlocked) {
            throw new ForbiddenException('Cannot send messages to this user');
        }

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
        // Use SQL SUM instead of loading all conversations into memory
        const result = await this.conversationRepository
            .createQueryBuilder('c')
            .select(
                `SUM(CASE WHEN c.user1Id = :userId THEN c.user1UnreadCount ELSE c.user2UnreadCount END)`,
                'total',
            )
            .where('(c.user1Id = :userId OR c.user2Id = :userId)')
            .andWhere('c.isActive = true')
            .setParameter('userId', userId)
            .getRawOne();

        return parseInt(result?.total || '0', 10);
    }

    // ─── PUBLIC: Get conversation participant IDs ─────────

    async getConversationParticipants(conversationId: string): Promise<string[] | null> {
        const conversation = await this.conversationRepository.findOne({
            where: { id: conversationId, isActive: true },
            select: ['user1Id', 'user2Id'],
        });
        if (!conversation) return null;
        return [conversation.user1Id, conversation.user2Id];
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

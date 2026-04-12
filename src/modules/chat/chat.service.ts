import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    BadRequestException,
    Inject,
    forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { Message, MessageType, MessageStatus } from '../../database/entities/message.entity';
import { Match, MatchStatus } from '../../database/entities/match.entity';
import { Conversation } from '../../database/entities/conversation.entity';
import { Photo } from '../../database/entities/photo.entity';
import { BlockedUser } from '../../database/entities/blocked-user.entity';
import { User } from '../../database/entities/user.entity';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { ChatGateway } from './chat.gateway';
import { RedisService } from '../redis/redis.service';

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
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        private readonly configService: ConfigService,
        private readonly redisService: RedisService,
        @Inject(forwardRef(() => ChatGateway))
        private readonly chatGateway: ChatGateway,
    ) { }

    // ─── CONVERSATIONS LIST ─────────────────────────────────
    async findById(id: string): Promise<Conversation | null> {
        return this.conversationRepository.findOne({ where: { id, isActive: true } });
    }

    async findOrCreateConversation(user1Id: string, user2Id: string): Promise<Conversation> {
        if (user1Id === user2Id) {
            throw new BadRequestException('Cannot create a conversation with yourself');
        }

        // Enforce consistent ordering of IDs to avoid duplicates
        const [id1, id2] = [user1Id, user2Id].sort();

        const activeMatch = await this.matchRepository.findOne({
            where: { user1Id: id1, user2Id: id2, status: MatchStatus.ACTIVE },
            select: ['id'],
        });

        if (!activeMatch) {
            throw new ForbiddenException('Messaging is only available for active matches');
        }

        let conversation = await this.conversationRepository.findOne({
            where: { user1Id: id1, user2Id: id2, isActive: true },
        });

        if (!conversation) {
            conversation = this.conversationRepository.create({
                user1Id: id1,
                user2Id: id2,
                matchId: activeMatch.id,
                isActive: true,
                user1UnreadCount: 0,
                user2UnreadCount: 0,
            });
            conversation = await this.conversationRepository.save(conversation);
        } else if (!conversation.matchId) {
            await this.conversationRepository.update(conversation.id, { matchId: activeMatch.id });
            conversation.matchId = activeMatch.id;
        }

        return conversation;
    }

    async getConversations(userId: string, pagination: PaginationDto) {
        const [conversations, total] = await this.conversationRepository.findAndCount({
            where: [
                { user1Id: userId, isActive: true },
                { user2Id: userId, isActive: true },
                { user1Id: userId, isLocked: true },
                { user2Id: userId, isLocked: true },
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
                .andWhere('photo.moderationStatus = :approvedStatus', { approvedStatus: 'approved' })
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
                lastMessage: this.decryptContent(conv.lastMessageContent),
                lastMessageAt: conv.lastMessageAt,
                lastMessageSenderId: conv.lastMessageSenderId,
                unreadCount,
                isMuted,
                isLocked: conv.isLocked ?? false,
                lockReason: conv.lockReason ?? null,
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

        const decryptedMessages = messages.map((message) => {
            message.content = this.decryptContent(message.content);
            return message;
        });

        return {
            messages: decryptedMessages.reverse(),
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

        // Reject messages to locked conversations (banned/closed user)
        if (conversation.isLocked) {
            throw new ForbiddenException(conversation.lockReason || 'This conversation is no longer available.');
        }

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

        const activeMatch = conversation.matchId
            ? await this.matchRepository.findOne({
                where: { id: conversation.matchId, status: MatchStatus.ACTIVE },
                select: ['id'],
            })
            : await this.matchRepository.findOne({
                where: {
                    user1Id: [conversation.user1Id, conversation.user2Id].sort()[0],
                    user2Id: [conversation.user1Id, conversation.user2Id].sort()[1],
                    status: MatchStatus.ACTIVE,
                },
                select: ['id'],
            });

        if (!activeMatch) {
            throw new ForbiddenException('Messaging requires an active match');
        }

        if (!conversation.matchId) {
            await this.conversationRepository.update(conversation.id, { matchId: activeMatch.id });
            conversation.matchId = activeMatch.id;
        }

        const safeContent = content.trim();
        const encryptedContent = this.encryptContent(safeContent);
        const encryptedPreview = this.encryptContent(safeContent.substring(0, 200));

        const message = this.messageRepository.create({
            conversationId,
            matchId: conversation.matchId,
            senderId,
            content: encryptedContent,
            type,
            status: MessageStatus.SENT,
        });

        const saved = await this.messageRepository.save(message);

        // Update conversation metadata
        const isUser1 = conversation.user1Id === senderId;
        await this.conversationRepository.update(conversation.id, {
            lastMessageContent: encryptedPreview,
            lastMessageAt: new Date(),
            lastMessageSenderId: senderId,
            // Increment unread count for the other user
            ...(isUser1
                ? { user2UnreadCount: () => '"user2UnreadCount" + 1' }
                : { user1UnreadCount: () => '"user1UnreadCount" + 1' }),
        } as any);

        // Real-time broadcast (for users on Socket)
        const outboundMessage = {
            id: saved.id,
            conversationId: saved.conversationId,
            senderId: saved.senderId,
            content: safeContent,
            type: saved.type,
            status: saved.status,
            createdAt: saved.createdAt,
        };
        this.chatGateway.broadcastMessage(outboundMessage).catch(err => {
            console.error('Failed to broadcast message:', err);
        });

        saved.content = safeContent;
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

    async getLiveTodayUsers(userId: string, limit = 20) {
        const safeLimit = Math.max(1, Math.min(limit || 20, 50));
        const activeSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const onlineUserIds = await this.redisService.getOnlineUsers();
        const onlineSet = new Set(onlineUserIds);

        const query = this.userRepository
            .createQueryBuilder('user')
            .leftJoinAndSelect('user.profile', 'profile')
            .leftJoinAndSelect(
                'user.photos',
                'photo',
                'photo.isMain = :isMain AND photo.moderationStatus = :approvedPhotoStatus',
                { isMain: true, approvedPhotoStatus: 'approved' },
            )
            .where('user.id != :userId', { userId })
            .andWhere('user.status = :activeStatus', { activeStatus: 'active' })
            .andWhere('user.isShadowBanned = false')
            .andWhere(
                `NOT EXISTS (
                    SELECT 1
                    FROM blocked_users blocked
                    WHERE (
                        blocked."blockerId" = :userId
                        AND blocked."blockedId" = "user"."id"
                    ) OR (
                        blocked."blockerId" = "user"."id"
                        AND blocked."blockedId" = :userId
                    )
                )`,
                { userId },
            )
            .andWhere(
                `EXISTS (
                    SELECT 1
                    FROM photos approved_photo
                    WHERE approved_photo."userId" = "user"."id"
                    AND approved_photo."moderationStatus" = :approvedPhotoStatus
                )`,
                { approvedPhotoStatus: 'approved' },
            )
            .distinct(true)
            .take(Math.max(safeLimit * 2, safeLimit))
            .orderBy('user.lastLoginAt', 'DESC');

        if (onlineUserIds.length > 0) {
            query.andWhere('(user.lastLoginAt >= :activeSince OR user.id IN (:...onlineUserIds))', {
                activeSince,
                onlineUserIds,
            });
        } else {
            query.andWhere('user.lastLoginAt >= :activeSince', { activeSince });
        }

        const users = await query.getMany();
        const serialized = users
            .map((user) => {
                const mainPhoto =
                    user.photos?.find((photo) => photo.isMain) ??
                    user.photos?.[0] ??
                    null;

                return {
                    id: user.id,
                    username: user.username,
                    email: '',
                    firstName: user.firstName,
                    lastName: user.lastName,
                    phoneVerified: user.phoneVerified ?? false,
                    selfieVerified: user.selfieVerified,
                    status: onlineSet.has(user.id) ? 'online' : 'active',
                    isOnline: onlineSet.has(user.id),
                    lastLoginAt: user.lastLoginAt,
                    mainPhotoUrl: mainPhoto?.url ?? null,
                    photos: mainPhoto
                        ? [{
                            id: mainPhoto.id,
                            url: mainPhoto.url,
                            isMain: mainPhoto.isMain,
                            moderationStatus: mainPhoto.moderationStatus,
                        }]
                        : [],
                    profile: user.profile ?? null,
                };
            })
            .sort((left, right) => {
                const leftOnline = onlineSet.has(left.id) ? 1 : 0;
                const rightOnline = onlineSet.has(right.id) ? 1 : 0;
                if (leftOnline !== rightOnline) {
                    return rightOnline - leftOnline;
                }

                const leftSeen = left.lastLoginAt
                    ? new Date(left.lastLoginAt).getTime()
                    : 0;
                const rightSeen = right.lastLoginAt
                    ? new Date(right.lastLoginAt).getTime()
                    : 0;
                return rightSeen - leftSeen;
            })
            .slice(0, safeLimit);

        return {
            users: serialized,
            total: serialized.length,
        };
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
        // Allow access to both active and locked conversations (locked = read-only)
        const conversation = await this.conversationRepository.findOne({
            where: [
                { id: conversationId, user1Id: userId },
                { id: conversationId, user2Id: userId },
            ],
        });

        if (!conversation) {
            throw new ForbiddenException('You are not part of this conversation');
        }
        return conversation;
    }

    // ─── CHAT SETTINGS ─────────────────────────────────────

    async getChatSettings(userId: string) {
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: ['id', 'readReceipts', 'typingIndicator', 'autoDownloadMedia', 'receiveDMs'],
        });
        if (!user) throw new NotFoundException('User not found');
        return {
            readReceipts: user.readReceipts ?? true,
            typingIndicator: user.typingIndicator ?? true,
            autoDownloadMedia: user.autoDownloadMedia ?? true,
            receiveDMs: user.receiveDMs ?? true,
        };
    }

    private static readonly ALLOWED_CHAT_SETTINGS = [
        'readReceipts', 'typingIndicator', 'autoDownloadMedia', 'receiveDMs',
    ];

    async updateChatSettings(
        userId: string,
        settings: Record<string, boolean>,
    ): Promise<void> {
        const update: Record<string, boolean> = {};
        for (const key of ChatService.ALLOWED_CHAT_SETTINGS) {
            if (settings[key] !== undefined) {
                update[key] = settings[key];
            }
        }
        if (Object.keys(update).length > 0) {
            await this.userRepository.update(userId, update);
        }
    }

    decryptMessageContent(content: string | null | undefined): string {
        return this.decryptContent(content);
    }

    private encryptContent(content: string | null | undefined): string {
        const value = content ?? '';
        if (value.length === 0) {
            return value;
        }

        const encryptionKey = this.getEncryptionKey();
        if (encryptionKey == null || value.startsWith('enc:v1:')) {
            return value;
        }

        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
        const encrypted = Buffer.concat([
            cipher.update(value, 'utf8'),
            cipher.final(),
        ]);
        const authTag = cipher.getAuthTag();

        return `enc:v1:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
    }

    private decryptContent(content: string | null | undefined): string {
        const value = content ?? '';
        if (!value.startsWith('enc:v1:')) {
            return value;
        }

        const encryptionKey = this.getEncryptionKey();
        if (encryptionKey == null) {
            return value;
        }

        try {
            const [, , ivPart, tagPart, cipherPart] = value.split(':');
            const decipher = createDecipheriv(
                'aes-256-gcm',
                encryptionKey,
                Buffer.from(ivPart, 'base64'),
            );
            decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
            const decrypted = Buffer.concat([
                decipher.update(Buffer.from(cipherPart, 'base64')),
                decipher.final(),
            ]);
            return decrypted.toString('utf8');
        } catch {
            return value;
        }
    }

    private getEncryptionKey(): Buffer | null {
        const rawKey = this.configService.get<string>('CHAT_ENCRYPTION_KEY');
        if (!rawKey || rawKey.trim().length === 0) {
            return null;
        }

        return createHash('sha256').update(rawKey).digest();
    }
}

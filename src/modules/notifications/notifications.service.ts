import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationType } from '../../database/entities/notification.entity';
import { User } from '../../database/entities/user.entity';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { NotificationGateway } from './notification.gateway';

@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);

    constructor(
        @InjectRepository(Notification)
        private readonly notificationRepository: Repository<Notification>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @Inject(forwardRef(() => NotificationGateway))
        private readonly notificationGateway: NotificationGateway,
    ) { }

    async createNotification(
        userId: string,
        data: {
            type: string;
            title: string;
            body: string;
            data?: Record<string, any>;
        },
    ): Promise<Notification> {
        const notification = this.notificationRepository.create({
            userId,
            type: data.type as NotificationType,
            title: data.title,
            body: data.body,
            data: data.data,
        });
        const saved = await this.notificationRepository.save(notification);

        // Emit real-time WebSocket notification
        this.notificationGateway.sendToUser(userId, saved);

        return saved;
    }

    async getNotifications(userId: string, pagination: PaginationDto) {
        const [notifications, total] = await this.notificationRepository.findAndCount({
            where: { userId },
            order: { createdAt: 'DESC' },
            skip: pagination.skip,
            take: pagination.limit,
        });

        const unreadCount = await this.notificationRepository.count({
            where: { userId, isRead: false },
        });

        return { notifications, total, unreadCount, page: pagination.page, limit: pagination.limit };
    }

    async markAsRead(userId: string, notificationId: string): Promise<void> {
        await this.notificationRepository.update(
            { id: notificationId, userId },
            { isRead: true },
        );
    }

    async markAllAsRead(userId: string): Promise<void> {
        await this.notificationRepository.update(
            { userId, isRead: false },
            { isRead: true },
        );
    }

    async deleteNotification(userId: string, notificationId: string): Promise<void> {
        await this.notificationRepository.delete({ id: notificationId, userId });
    }

    async getUnreadCount(userId: string): Promise<number> {
        return this.notificationRepository.count({
            where: { userId, isRead: false },
        });
    }

    // ─── NOTIFICATION SETTINGS ──────────────────────────────

    async getNotificationSettings(userId: string) {
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: ['id', 'notificationsEnabled', 'matchNotifications', 'messageNotifications', 'likeNotifications'],
        });
        return {
            notificationsEnabled: user?.notificationsEnabled ?? true,
            matchNotifications: user?.matchNotifications ?? true,
            messageNotifications: user?.messageNotifications ?? true,
            likeNotifications: user?.likeNotifications ?? true,
        };
    }

    async updateNotificationSettings(
        userId: string,
        settings: {
            enabled?: boolean;
            matchNotifications?: boolean;
            messageNotifications?: boolean;
            likeNotifications?: boolean;
        },
    ): Promise<void> {
        const update: any = {};
        if (settings.enabled !== undefined) update.notificationsEnabled = settings.enabled;
        if (settings.matchNotifications !== undefined) update.matchNotifications = settings.matchNotifications;
        if (settings.messageNotifications !== undefined) update.messageNotifications = settings.messageNotifications;
        if (settings.likeNotifications !== undefined) update.likeNotifications = settings.likeNotifications;
        await this.userRepository.update(userId, update);
    }

    // ─── CONVENIENCE: Send typed notifications ─────────────

    async sendMatchNotification(userId: string, matchedUserName: string, data?: Record<string, any>): Promise<Notification> {
        return this.createNotification(userId, {
            type: 'match',
            title: 'New Match!',
            body: `You matched with ${matchedUserName}!`,
            data,
        });
    }

    async sendLikeNotification(userId: string, likerName: string, data?: Record<string, any>): Promise<Notification> {
        return this.createNotification(userId, {
            type: 'like',
            title: 'Someone likes you!',
            body: `${likerName} liked your profile`,
            data,
        });
    }

    async sendMessageNotification(userId: string, senderName: string, preview: string, data?: Record<string, any>): Promise<Notification> {
        return this.createNotification(userId, {
            type: 'message',
            title: `New message from ${senderName}`,
            body: preview.length > 80 ? preview.substring(0, 80) + '...' : preview,
            data,
        });
    }
}

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
            select: [
                'id', 'notificationsEnabled', 'matchNotifications', 'messageNotifications',
                'likeNotifications', 'profileVisitorNotifications', 'eventsNotifications',
                'safetyAlertNotifications', 'promotionsNotifications',
                'inAppRecommendationNotifications', 'weeklySummaryNotifications',
                'connectionRequestNotifications', 'surveyNotifications',
            ],
        });
        return {
            notificationsEnabled: user?.notificationsEnabled ?? true,
            matchNotifications: user?.matchNotifications ?? true,
            messageNotifications: user?.messageNotifications ?? true,
            likeNotifications: user?.likeNotifications ?? true,
            profileVisitorNotifications: user?.profileVisitorNotifications ?? false,
            eventsNotifications: user?.eventsNotifications ?? false,
            safetyAlertNotifications: user?.safetyAlertNotifications ?? true,
            promotionsNotifications: user?.promotionsNotifications ?? false,
            inAppRecommendationNotifications: user?.inAppRecommendationNotifications ?? false,
            weeklySummaryNotifications: user?.weeklySummaryNotifications ?? false,
            connectionRequestNotifications: user?.connectionRequestNotifications ?? true,
            surveyNotifications: user?.surveyNotifications ?? false,
        };
    }

    private static readonly ALLOWED_NOTIF_KEYS = [
        'notificationsEnabled', 'matchNotifications', 'messageNotifications',
        'likeNotifications', 'profileVisitorNotifications', 'eventsNotifications',
        'safetyAlertNotifications', 'promotionsNotifications',
        'inAppRecommendationNotifications', 'weeklySummaryNotifications',
        'connectionRequestNotifications', 'surveyNotifications',
    ];

    async updateNotificationSettings(
        userId: string,
        settings: Record<string, boolean>,
    ): Promise<void> {
        const update: any = {};
        for (const key of NotificationsService.ALLOWED_NOTIF_KEYS) {
            if (settings[key] !== undefined) {
                update[key] = settings[key];
            }
        }
        // Legacy support: 'enabled' maps to 'notificationsEnabled'
        if (settings.enabled !== undefined) update.notificationsEnabled = settings.enabled;
        if (Object.keys(update).length > 0) {
            await this.userRepository.update(userId, update);
        }
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

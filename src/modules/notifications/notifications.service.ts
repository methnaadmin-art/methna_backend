import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationType } from '../../database/entities/notification.entity';
import { User } from '../../database/entities/user.entity';
import { PaginationDto } from '../../common/dto/pagination.dto';

@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);

    constructor(
        @InjectRepository(Notification)
        private readonly notificationRepository: Repository<Notification>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
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

        // Send push notification if user has notifications enabled and FCM token
        await this.sendPushNotification(userId, data);

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

    // ─── FIREBASE PUSH (STUB) ───────────────────────────────

    private async sendPushNotification(
        userId: string,
        data: { type: string; title: string; body: string; data?: Record<string, any> },
    ): Promise<void> {
        try {
            const user = await this.userRepository.findOne({
                where: { id: userId },
                select: ['id', 'fcmToken', 'notificationsEnabled'],
            });

            if (!user || !user.fcmToken || !user.notificationsEnabled) {
                return;
            }

            // Firebase Admin SDK push notification
            // TODO: Initialize firebase-admin and send actual push
            // Example implementation:
            // import * as admin from 'firebase-admin';
            // await admin.messaging().send({
            //     token: user.fcmToken,
            //     notification: { title: data.title, body: data.body },
            //     data: data.data ? Object.fromEntries(
            //         Object.entries(data.data).map(([k, v]) => [k, String(v)])
            //     ) : undefined,
            // });

            this.logger.debug(`Push notification stub for user ${userId}: ${data.title}`);
        } catch (error) {
            this.logger.error(`Failed to send push to ${userId}`, error);
        }
    }
}

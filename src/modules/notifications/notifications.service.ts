import * as crypto from 'crypto';
import * as https from 'https';
import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationType } from '../../database/entities/notification.entity';
import { User } from '../../database/entities/user.entity';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { NotificationGateway } from './notification.gateway';
import { RedisService } from '../redis/redis.service';

type PushEligibleUser = Pick<
    User,
    | 'id'
    | 'fcmToken'
    | 'notificationsEnabled'
    | 'matchNotifications'
    | 'messageNotifications'
    | 'likeNotifications'
    | 'profileVisitorNotifications'
    | 'eventsNotifications'
    | 'safetyAlertNotifications'
    | 'promotionsNotifications'
    | 'inAppRecommendationNotifications'
    | 'weeklySummaryNotifications'
    | 'connectionRequestNotifications'
    | 'surveyNotifications'
>;

type NormalizedNotificationPayload = {
    storedType: NotificationType;
    data?: Record<string, any>;
};

@Injectable()
export class NotificationsService {
    private readonly logger = new Logger(NotificationsService.name);
    private firebaseAccessTokenCache: { token: string; expiresAt: number } | null = null;

    constructor(
        @InjectRepository(Notification)
        private readonly notificationRepository: Repository<Notification>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @Inject(forwardRef(() => NotificationGateway))
        private readonly notificationGateway: NotificationGateway,
        private readonly redisService: RedisService,
        private readonly configService: ConfigService,
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
        const normalized = this.normalizeNotificationPayload(data);
        const notification = this.notificationRepository.create({
            userId,
            type: normalized.storedType,
            title: data.title,
            body: data.body,
            data: normalized.data,
        });
        const saved = await this.notificationRepository.save(notification);

        this.notificationGateway.sendToUser(userId, saved);
        this.dispatchPushNotification(userId, saved).catch((error: Error) => {
            this.logger.warn(`Push delivery failed for notification ${saved.id}: ${error.message}`);
        });

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

    async updateFcmToken(userId: string, fcmToken?: string): Promise<void> {
        await this.userRepository.update(userId, {
            fcmToken: fcmToken ?? null,
        } as any);
    }

    private normalizeNotificationPayload(data: {
        type: string;
        title: string;
        body: string;
        data?: Record<string, any>;
    }): NormalizedNotificationPayload {
        const clientType = (data.type || NotificationType.SYSTEM).trim().toLowerCase();
        const storedType = this.mapNotificationTypeForStorage(clientType);
        const payloadData = { ...(data.data ?? {}) };

        if (clientType !== storedType) {
            payloadData.notificationType = clientType;
        }

        return {
            storedType,
            data: Object.keys(payloadData).length > 0 ? payloadData : undefined,
        };
    }

    private mapNotificationTypeForStorage(type: string): NotificationType {
        switch (type) {
            case NotificationType.MATCH:
                return NotificationType.MATCH;
            case NotificationType.MESSAGE:
                return NotificationType.MESSAGE;
            case NotificationType.LIKE:
            case 'super_like':
            case 'compliment':
                return NotificationType.LIKE;
            case NotificationType.SUBSCRIPTION:
                return NotificationType.SUBSCRIPTION;
            case NotificationType.PROFILE_VIEW:
                return NotificationType.PROFILE_VIEW;
            case NotificationType.VERIFICATION:
                return NotificationType.VERIFICATION;
            default:
                return NotificationType.SYSTEM;
        }
    }

    private resolveClientNotificationType(notification: Notification): string {
        const rawType = notification.data?.notificationType ?? notification.type;
        return rawType?.toString().trim().toLowerCase() || NotificationType.SYSTEM;
    }

    private async dispatchPushNotification(userId: string, notification: Notification): Promise<void> {
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: [
                'id',
                'fcmToken',
                'notificationsEnabled',
                'matchNotifications',
                'messageNotifications',
                'likeNotifications',
                'profileVisitorNotifications',
                'eventsNotifications',
                'safetyAlertNotifications',
                'promotionsNotifications',
                'inAppRecommendationNotifications',
                'weeklySummaryNotifications',
                'connectionRequestNotifications',
                'surveyNotifications',
            ],
        });

        if (!user?.fcmToken || !user.notificationsEnabled) {
            return;
        }

        if (!this.shouldSendPushNotification(user as PushEligibleUser, notification)) {
            return;
        }

        try {
            const isOnline = await this.redisService.isUserOnline(userId);
            if (isOnline) {
                return;
            }
        } catch (error) {
            this.logger.debug(`Redis online check failed for push delivery: ${(error as Error).message}`);
        }

        const payload = this.buildPushPayload(notification);

        if (await this.sendViaFirebaseV1(user as PushEligibleUser, payload)) {
            return;
        }

        if (await this.sendViaLegacyFcm(user as PushEligibleUser, payload)) {
            return;
        }

        this.logger.debug(
            `Push delivery skipped for user ${userId}: FIREBASE_* credentials or FCM_SERVER_KEY are not configured.`,
        );
    }

    private shouldSendPushNotification(user: PushEligibleUser, notification: Notification): boolean {
        const clientType = this.resolveClientNotificationType(notification);

        switch (clientType) {
            case NotificationType.MATCH:
                return user.matchNotifications;
            case NotificationType.MESSAGE:
                return user.messageNotifications;
            case NotificationType.LIKE:
            case 'super_like':
            case 'compliment':
                return user.likeNotifications;
            case NotificationType.PROFILE_VIEW:
                return user.profileVisitorNotifications;
            case NotificationType.VERIFICATION:
                return user.safetyAlertNotifications;
            case 'connection_request':
                return user.connectionRequestNotifications;
            case 'recommendation':
                return user.inAppRecommendationNotifications;
            case 'weekly_summary':
                return user.weeklySummaryNotifications;
            case 'survey':
                return user.surveyNotifications;
            default: {
                const category = notification.data?.category?.toString().trim().toLowerCase();
                if (category === 'event') return user.eventsNotifications;
                if (category === 'promotion') return user.promotionsNotifications;
                if (category === 'recommendation') return user.inAppRecommendationNotifications;
                if (category === 'weekly_summary') return user.weeklySummaryNotifications;
                if (category === 'survey') return user.surveyNotifications;
                if (category === 'safety') return user.safetyAlertNotifications;
                return true;
            }
        }
    }

    private buildPushPayload(notification: Notification): {
        title: string;
        body: string;
        data: Record<string, string>;
    } {
        const clientType = this.resolveClientNotificationType(notification);
        const createdAt = notification.createdAt instanceof Date
            ? notification.createdAt.toISOString()
            : new Date().toISOString();

        return {
            title: notification.title,
            body: notification.body,
            data: this.stringifyPushData({
                notificationId: notification.id,
                type: clientType,
                createdAt,
                ...(notification.data ?? {}),
            }),
        };
    }

    private stringifyPushData(data: Record<string, any>): Record<string, string> {
        const payload: Record<string, string> = {};

        for (const [key, value] of Object.entries(data)) {
            if (value === undefined || value === null) {
                continue;
            }

            if (typeof value === 'string') {
                payload[key] = value;
                continue;
            }

            if (typeof value === 'number' || typeof value === 'boolean') {
                payload[key] = String(value);
                continue;
            }

            payload[key] = JSON.stringify(value);
        }

        return payload;
    }

    private async sendViaFirebaseV1(
        user: PushEligibleUser,
        payload: { title: string; body: string; data: Record<string, string> },
    ): Promise<boolean> {
        const projectId = this.configService.get<string>('firebase.projectId') || process.env.FIREBASE_PROJECT_ID;
        const clientEmail = this.configService.get<string>('firebase.clientEmail') || process.env.FIREBASE_CLIENT_EMAIL;
        const privateKey = this.configService.get<string>('firebase.privateKey') || process.env.FIREBASE_PRIVATE_KEY;

        if (!projectId || !clientEmail || !privateKey) {
            return false;
        }

        const accessToken = await this.getFirebaseAccessToken(clientEmail, privateKey);
        if (!accessToken) {
            return false;
        }

        const response = await this.httpPost(
            `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
            JSON.stringify({
                message: {
                    token: user.fcmToken,
                    notification: {
                        title: payload.title,
                        body: payload.body,
                    },
                    data: payload.data,
                    android: {
                        priority: 'high',
                        notification: {
                            channelId: 'high_importance_channel',
                            sound: 'default',
                        },
                    },
                    apns: {
                        headers: {
                            'apns-priority': '10',
                        },
                        payload: {
                            aps: {
                                sound: 'default',
                            },
                        },
                    },
                },
            }),
            {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
        );

        if (response.statusCode >= 200 && response.statusCode < 300) {
            return true;
        }

        if (response.rawBody.includes('UNREGISTERED') || response.rawBody.includes('registration-token-not-registered')) {
            await this.clearInvalidFcmToken(user.id, user.fcmToken || null);
        }

        this.logger.warn(`Firebase v1 push failed (${response.statusCode}): ${response.rawBody || 'empty response'}`);
        return false;
    }

    private async sendViaLegacyFcm(
        user: PushEligibleUser,
        payload: { title: string; body: string; data: Record<string, string> },
    ): Promise<boolean> {
        const serverKey = process.env.FCM_SERVER_KEY || process.env.FIREBASE_SERVER_KEY;
        if (!serverKey) {
            return false;
        }

        const response = await this.httpPost(
            'https://fcm.googleapis.com/fcm/send',
            JSON.stringify({
                to: user.fcmToken,
                priority: 'high',
                notification: {
                    title: payload.title,
                    body: payload.body,
                    sound: 'default',
                },
                data: payload.data,
            }),
            {
                Authorization: `key=${serverKey}`,
                'Content-Type': 'application/json',
            },
        );

        const resultError = response.data?.results?.[0]?.error;
        if (resultError === 'NotRegistered' || resultError === 'InvalidRegistration') {
            await this.clearInvalidFcmToken(user.id, user.fcmToken || null);
            return false;
        }

        if (response.statusCode >= 200 && response.statusCode < 300) {
            return true;
        }

        this.logger.warn(`Legacy FCM push failed (${response.statusCode}): ${response.rawBody || 'empty response'}`);
        return false;
    }

    private async clearInvalidFcmToken(userId: string, currentToken: string | null): Promise<void> {
        if (!currentToken) {
            return;
        }

        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: ['id', 'fcmToken'],
        });

        if (user?.fcmToken === currentToken) {
            await this.userRepository.update(userId, { fcmToken: null } as any);
        }
    }

    private async getFirebaseAccessToken(clientEmail: string, privateKey: string): Promise<string | null> {
        const cached = this.firebaseAccessTokenCache;
        if (cached && cached.expiresAt > Date.now() + 60_000) {
            return cached.token;
        }

        const nowInSeconds = Math.floor(Date.now() / 1000);
        const jwt = this.buildServiceAccountJwt(clientEmail, privateKey, nowInSeconds);
        const form = new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt,
        });

        const response = await this.httpPost(
            'https://oauth2.googleapis.com/token',
            form.toString(),
            {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        );

        const accessToken = response.data?.access_token;
        const expiresIn = Number(response.data?.expires_in ?? 3600);

        if (!accessToken) {
            this.logger.warn(`Unable to fetch Firebase access token: ${response.rawBody || 'empty response'}`);
            return null;
        }

        this.firebaseAccessTokenCache = {
            token: accessToken,
            expiresAt: Date.now() + Math.max(expiresIn - 120, 60) * 1000,
        };

        return accessToken;
    }

    private buildServiceAccountJwt(clientEmail: string, privateKey: string, nowInSeconds: number): string {
        const header = this.toBase64Url(
            Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
        );
        const payload = this.toBase64Url(
            Buffer.from(
                JSON.stringify({
                    iss: clientEmail,
                    scope: 'https://www.googleapis.com/auth/firebase.messaging',
                    aud: 'https://oauth2.googleapis.com/token',
                    iat: nowInSeconds,
                    exp: nowInSeconds + 3600,
                }),
            ),
        );
        const unsignedToken = `${header}.${payload}`;
        const signer = crypto.createSign('RSA-SHA256');
        signer.update(unsignedToken);
        signer.end();

        return `${unsignedToken}.${this.toBase64Url(signer.sign(privateKey))}`;
    }

    private toBase64Url(value: Buffer): string {
        return value
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/g, '');
    }

    private async httpPost(
        url: string,
        body: string,
        headers: Record<string, string>,
    ): Promise<{ statusCode: number; rawBody: string; data: any }> {
        return new Promise((resolve, reject) => {
            const request = https.request(
                url,
                {
                    method: 'POST',
                    headers: {
                        'Content-Length': Buffer.byteLength(body).toString(),
                        ...headers,
                    },
                },
                (response) => {
                    let rawBody = '';
                    response.setEncoding('utf8');
                    response.on('data', (chunk) => {
                        rawBody += chunk;
                    });
                    response.on('end', () => {
                        let data: any = null;
                        try {
                            data = rawBody ? JSON.parse(rawBody) : null;
                        } catch {
                            data = null;
                        }

                        resolve({
                            statusCode: response.statusCode ?? 0,
                            rawBody,
                            data,
                        });
                    });
                },
            );

            request.on('error', reject);
            request.write(body);
            request.end();
        });
    }

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
        if (settings.enabled !== undefined) update.notificationsEnabled = settings.enabled;
        if (Object.keys(update).length > 0) {
            await this.userRepository.update(userId, update);
        }
    }

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

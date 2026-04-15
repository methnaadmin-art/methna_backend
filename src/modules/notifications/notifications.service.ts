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

type NotificationInput = {
    userId?: string;
    conversationId?: string;
    extraData?: Record<string, any>;
    type: string;
    title: string;
    body: string;
    data?: Record<string, any>;
};

type NotificationPayload = {
    type: string;
    userId?: string;
    conversationId?: string;
    title: string;
    body: string;
    extraData: Record<string, any>;
};

type NormalizedNotificationPayload = {
    storedType: NotificationType;
    clientType: string;
    payload: NotificationPayload;
    data: Record<string, any>;
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
        data: NotificationInput,
    ): Promise<Notification> {
        const normalized = this.normalizeNotificationPayload(userId, data);
        const notification = this.notificationRepository.create({
            userId,
            type: normalized.storedType,
            title: normalized.payload.title,
            body: normalized.payload.body,
            data: normalized.data,
        });
        const saved = await this.notificationRepository.save(notification);

        this.logger.log(
            `Notification sent to user ${userId}: type=${normalized.clientType}, payload=${JSON.stringify(normalized.payload)}`,
        );

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

    private normalizeNotificationPayload(
        targetUserId: string,
        data: NotificationInput,
    ): NormalizedNotificationPayload {
        const rawType = (data.type || NotificationType.SYSTEM).trim().toLowerCase();
        const { clientType, storedType } = this.normalizeNotificationType(rawType);
        const payloadData = { ...(data.data ?? {}) };
        const conversationId =
            this.normalizeOptionalString(data.conversationId) ||
            this.normalizeOptionalString(payloadData.conversationId) ||
            undefined;

        delete payloadData.conversationId;

        let payloadUserId =
            this.normalizeOptionalString(data.userId) ||
            this.normalizeOptionalString(payloadData.userId) ||
            this.normalizeOptionalString(payloadData.senderId) ||
            this.normalizeOptionalString(payloadData.likerId) ||
            this.normalizeOptionalString(payloadData.requesterId) ||
            this.normalizeOptionalString(payloadData.viewerId);

        delete payloadData.userId;
        delete payloadData.senderId;
        delete payloadData.likerId;
        delete payloadData.requesterId;
        delete payloadData.viewerId;

        const extraData = {
            ...payloadData,
            ...(data.extraData ?? {}),
        };

        if (rawType !== clientType) {
            extraData.originalType = rawType;
        }

        if (clientType === NotificationType.LIKE && extraData.isAnonymousLike === true && !payloadUserId) {
            payloadUserId = '';
        }

        const payload = this.enforceNotificationPayload({
            type: clientType,
            userId: payloadUserId,
            conversationId,
            title: data.title,
            body: data.body,
            extraData,
        });

        return {
            storedType,
            clientType,
            payload,
            data: {
                type: payload.type,
                userId: payload.userId,
                conversationId: payload.conversationId,
                title: payload.title,
                body: payload.body,
                extraData: payload.extraData,
                payload,
            },
        };
    }

    private normalizeNotificationType(type: string): { clientType: string; storedType: NotificationType } {
        switch (type) {
            case NotificationType.MATCH:
                return { clientType: NotificationType.MATCH, storedType: NotificationType.MATCH };
            case NotificationType.MESSAGE:
                return { clientType: NotificationType.MESSAGE, storedType: NotificationType.MESSAGE };
            case NotificationType.LIKE:
            case 'super_like':
            case 'compliment':
                return { clientType: NotificationType.LIKE, storedType: NotificationType.LIKE };
            case NotificationType.SUBSCRIPTION:
                return { clientType: NotificationType.SUBSCRIPTION, storedType: NotificationType.SUBSCRIPTION };
            case NotificationType.TICKET:
            case 'support':
            case 'support_reply':
                return { clientType: NotificationType.TICKET, storedType: NotificationType.TICKET };
            case NotificationType.PROFILE_VIEW:
                return { clientType: NotificationType.PROFILE_VIEW, storedType: NotificationType.PROFILE_VIEW };
            case NotificationType.VERIFICATION:
                return { clientType: NotificationType.VERIFICATION, storedType: NotificationType.VERIFICATION };
            default:
                return {
                    clientType: type || NotificationType.SYSTEM,
                    storedType: NotificationType.SYSTEM,
                };
        }
    }

    private resolveClientNotificationType(notification: Notification): string {
        const rawType =
            notification.data?.type ??
            notification.data?.payload?.type ??
            notification.data?.notificationType ??
            notification.type;
        return this.normalizeNotificationType(
            rawType?.toString().trim().toLowerCase() || NotificationType.SYSTEM,
        ).clientType;
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

        const payload = this.buildPushPayload(notification);

        if (await this.sendViaFirebaseV1(user as PushEligibleUser, payload)) {
            this.logger.log(
                `Push notification delivered via Firebase v1 to user ${userId}: type=${payload.data.type}, payload=${JSON.stringify(payload.data)}`,
            );
            return;
        }

        if (await this.sendViaLegacyFcm(user as PushEligibleUser, payload)) {
            this.logger.log(
                `Push notification delivered via legacy FCM to user ${userId}: type=${payload.data.type}, payload=${JSON.stringify(payload.data)}`,
            );
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
            case NotificationType.TICKET:
                return true;
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
        const payload = this.extractNotificationPayload(notification);
        const createdAt = notification.createdAt instanceof Date
            ? notification.createdAt.toISOString()
            : new Date().toISOString();

        return {
            title: payload.title,
            body: payload.body,
            data: this.stringifyPushData({
                notificationId: notification.id,
                createdAt,
                type: payload.type,
                userId: payload.userId,
                conversationId: payload.conversationId,
                title: payload.title,
                body: payload.body,
                extraData: payload.extraData,
                payload,
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
                                'content-available': 1,
                                'mutable-content': 1,
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
                content_available: true,
                mutable_content: true,
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

    private extractNotificationPayload(notification: Notification): NotificationPayload {
        const rawPayload = notification.data?.payload ?? notification.data ?? {};
        const extraData = this.normalizeExtraData(rawPayload.extraData ?? notification.data?.extraData);

        return this.enforceNotificationPayload({
            type: this.resolveClientNotificationType(notification),
            userId: this.normalizeOptionalString(rawPayload.userId ?? notification.data?.userId),
            conversationId: this.normalizeOptionalString(
                rawPayload.conversationId ?? notification.data?.conversationId,
            ),
            title: rawPayload.title?.toString() || notification.title,
            body: rawPayload.body?.toString() || notification.body,
            extraData,
        });
    }

    private enforceNotificationPayload(payload: NotificationPayload): NotificationPayload {
        const normalizedPayload: NotificationPayload = {
            ...payload,
            userId: this.normalizeOptionalString(payload.userId),
            conversationId: this.normalizeOptionalString(payload.conversationId),
            title: payload.title,
            body: payload.body,
            extraData: this.normalizeExtraData(payload.extraData),
        };

        switch (normalizedPayload.type) {
            case NotificationType.MATCH:
                if (!normalizedPayload.userId) {
                    this.logger.warn('Match notification missing userId');
                }
                break;
            case NotificationType.MESSAGE:
                if (!normalizedPayload.userId) {
                    this.logger.warn('Message notification missing userId');
                }
                if (!normalizedPayload.conversationId) {
                    this.logger.warn('Message notification missing conversationId');
                }
                break;
            case NotificationType.LIKE:
                if (!normalizedPayload.userId && normalizedPayload.extraData.isAnonymousLike !== true) {
                    this.logger.warn('Like notification missing userId');
                }
                if (normalizedPayload.extraData.isAnonymousLike === true && !normalizedPayload.userId) {
                    normalizedPayload.userId = '';
                }
                break;
            case NotificationType.TICKET:
                if (!normalizedPayload.extraData.ticketId) {
                    this.logger.warn('Ticket notification missing extraData.ticketId');
                }
                break;
            default:
                break;
        }

        return normalizedPayload;
    }

    private normalizeExtraData(value: unknown): Record<string, any> {
        if (!value) {
            return {};
        }

        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch {
                return {};
            }
        }

        if (typeof value === 'object') {
            return { ...(value as Record<string, any>) };
        }

        return {};
    }

    private normalizeOptionalString(value: unknown): string | undefined {
        if (typeof value !== 'string') {
            return undefined;
        }

        const trimmed = value.trim();
        return trimmed ? trimmed : undefined;
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

        // Repair legacy defaults where optional categories were initialized as false
        // for users who never configured notification preferences.
        const hasLegacyDefaultPattern =
            !!user &&
            (user.notificationsEnabled ?? true) &&
            (user.matchNotifications ?? true) &&
            (user.messageNotifications ?? true) &&
            (user.likeNotifications ?? true) &&
            (user.safetyAlertNotifications ?? true) &&
            (user.connectionRequestNotifications ?? true) &&
            user.profileVisitorNotifications === false &&
            user.eventsNotifications === false &&
            user.promotionsNotifications === false &&
            user.inAppRecommendationNotifications === false &&
            user.weeklySummaryNotifications === false &&
            user.surveyNotifications === false;

        if (hasLegacyDefaultPattern) {
            await this.userRepository.update(userId, {
                profileVisitorNotifications: true,
                eventsNotifications: true,
                promotionsNotifications: true,
                inAppRecommendationNotifications: true,
                weeklySummaryNotifications: true,
                surveyNotifications: true,
            });

            if (user) {
                user.profileVisitorNotifications = true;
                user.eventsNotifications = true;
                user.promotionsNotifications = true;
                user.inAppRecommendationNotifications = true;
                user.weeklySummaryNotifications = true;
                user.surveyNotifications = true;
            }
        }

        return {
            notificationsEnabled: user?.notificationsEnabled ?? true,
            matchNotifications: user?.matchNotifications ?? true,
            messageNotifications: user?.messageNotifications ?? true,
            likeNotifications: user?.likeNotifications ?? true,
            profileVisitorNotifications: user?.profileVisitorNotifications ?? true,
            eventsNotifications: user?.eventsNotifications ?? true,
            safetyAlertNotifications: user?.safetyAlertNotifications ?? true,
            promotionsNotifications: user?.promotionsNotifications ?? true,
            inAppRecommendationNotifications: user?.inAppRecommendationNotifications ?? true,
            weeklySummaryNotifications: user?.weeklySummaryNotifications ?? true,
            connectionRequestNotifications: user?.connectionRequestNotifications ?? true,
            surveyNotifications: user?.surveyNotifications ?? true,
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
            userId: this.normalizeOptionalString(data?.userId),
            conversationId: this.normalizeOptionalString(data?.conversationId),
            title: 'New Match!',
            body: `You matched with ${matchedUserName}!`,
            extraData: data,
        });
    }

    async sendLikeNotification(userId: string, likerName: string, data?: Record<string, any>): Promise<Notification> {
        return this.createNotification(userId, {
            type: 'like',
            userId: this.normalizeOptionalString(data?.userId ?? data?.likerId),
            title: 'Someone likes you!',
            body: `${likerName} liked your profile`,
            extraData: data,
        });
    }

    async sendMessageNotification(userId: string, senderName: string, preview: string, data?: Record<string, any>): Promise<Notification> {
        return this.createNotification(userId, {
            type: 'message',
            userId: this.normalizeOptionalString(data?.userId ?? data?.senderId),
            conversationId: this.normalizeOptionalString(data?.conversationId),
            title: `New message from ${senderName}`,
            body: preview.length > 80 ? preview.substring(0, 80) + '...' : preview,
            extraData: data,
        });
    }

    async sendSubscriptionNotification(
        userId: string,
        title: string,
        body: string,
        data?: Record<string, any>,
    ): Promise<Notification> {
        return this.createNotification(userId, {
            type: 'subscription',
            title,
            body,
            extraData: data,
        });
    }

    async sendTicketNotification(
        userId: string,
        title: string,
        body: string,
        data?: Record<string, any>,
    ): Promise<Notification> {
        return this.createNotification(userId, {
            type: 'ticket',
            title,
            body,
            extraData: data,
        });
    }
}

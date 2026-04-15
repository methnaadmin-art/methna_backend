import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Param,
    Query,
    Body,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
    constructor(private readonly notificationsService: NotificationsService) { }

    @Get()
    @ApiOperation({ summary: 'Get notifications' })
    async getNotifications(
        @CurrentUser('sub') userId: string,
        @Query() pagination: PaginationDto,
    ) {
        return this.notificationsService.getNotifications(userId, pagination);
    }

    @Get('unread-count')
    @ApiOperation({ summary: 'Get unread notification count' })
    async getUnreadCount(@CurrentUser('sub') userId: string) {
        const count = await this.notificationsService.getUnreadCount(userId);
        return { unreadCount: count };
    }

    @Patch(':id/read')
    @ApiOperation({ summary: 'Mark notification as read' })
    async markAsRead(
        @CurrentUser('sub') userId: string,
        @Param('id') notificationId: string,
    ) {
        await this.notificationsService.markAsRead(userId, notificationId);
        return { message: 'Notification marked as read' };
    }

    @Patch(':id/unread')
    @ApiOperation({ summary: 'Mark notification as unread' })
    async markAsUnread(
        @CurrentUser('sub') userId: string,
        @Param('id') notificationId: string,
    ) {
        await this.notificationsService.markAsUnread(userId, notificationId);
        return { message: 'Notification marked as unread' };
    }

    @Patch('read-all')
    @ApiOperation({ summary: 'Mark all notifications as read' })
    async markAllAsRead(@CurrentUser('sub') userId: string) {
        await this.notificationsService.markAllAsRead(userId);
        return { message: 'All notifications marked as read' };
    }

    @Delete('clear-all')
    @ApiOperation({ summary: 'Delete all notifications' })
    async clearAllNotifications(@CurrentUser('sub') userId: string) {
        await this.notificationsService.clearAllNotifications(userId);
        return { message: 'All notifications deleted' };
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete a notification' })
    async deleteNotification(
        @CurrentUser('sub') userId: string,
        @Param('id') notificationId: string,
    ) {
        await this.notificationsService.deleteNotification(userId, notificationId);
        return { message: 'Notification deleted' };
    }

    @Post('device-token')
    @ApiOperation({ summary: 'Legacy device token sync endpoint for push notifications' })
    async updateDeviceToken(
        @CurrentUser('sub') userId: string,
        @Body() body: { token?: string; fcmToken?: string },
    ) {
        await this.notificationsService.updateFcmToken(
            userId,
            body.fcmToken ?? body.token,
        );
        return { message: 'Push token updated' };
    }

    @Post('fcm-token')
    @ApiOperation({ summary: 'Legacy FCM token sync endpoint for push notifications' })
    async updateFcmToken(
        @CurrentUser('sub') userId: string,
        @Body() body: { fcmToken?: string; token?: string },
    ) {
        await this.notificationsService.updateFcmToken(
            userId,
            body.fcmToken ?? body.token,
        );
        return { message: 'FCM token updated' };
    }

    // ─── SETTINGS ───────────────────────────────────────────

    @Get('settings')
    @ApiOperation({ summary: 'Get notification settings' })
    async getSettings(@CurrentUser('sub') userId: string) {
        return this.notificationsService.getNotificationSettings(userId);
    }

    @Patch('settings')
    @ApiOperation({ summary: 'Update notification settings' })
    async updateSettings(
        @CurrentUser('sub') userId: string,
        @Body() settings: {
            enabled?: boolean;
            notificationsEnabled?: boolean;
            matchNotifications?: boolean;
            messageNotifications?: boolean;
            likeNotifications?: boolean;
            profileVisitorNotifications?: boolean;
            eventsNotifications?: boolean;
            safetyAlertNotifications?: boolean;
            promotionsNotifications?: boolean;
            inAppRecommendationNotifications?: boolean;
            weeklySummaryNotifications?: boolean;
            connectionRequestNotifications?: boolean;
            surveyNotifications?: boolean;
        },
    ) {
        await this.notificationsService.updateNotificationSettings(userId, settings);
        return { message: 'Notification settings updated' };
    }
}

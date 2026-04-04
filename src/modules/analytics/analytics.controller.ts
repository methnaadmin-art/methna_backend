import {
    Body,
    Controller,
    Get,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/entities/user.entity';
import { AnalyticsEventType } from '../../database/entities/analytics-event.entity';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('analytics')
export class AnalyticsController {
    constructor(private readonly analyticsService: AnalyticsService) { }

    @Get('dashboard')
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Get comprehensive admin analytics dashboard' })
    async getDashboard() {
        return this.analyticsService.getAdminAnalytics();
    }

    @Get('profile')
    @Roles(UserRole.USER, UserRole.ADMIN)
    @ApiOperation({ summary: 'Get profile analytics for the current user' })
    async getProfileAnalytics(
        @CurrentUser('sub') currentUserId: string,
        @Query('userId') userId?: string,
    ) {
        return this.analyticsService.getProfileAnalytics(userId || currentUserId);
    }

    @Post('track')
    @Roles(UserRole.USER, UserRole.ADMIN)
    @ApiOperation({ summary: 'Track a lightweight analytics event for the current user' })
    async trackEvent(
        @CurrentUser('sub') userId: string,
        @Body() body: Record<string, any>,
    ) {
        const eventType = this.mapEventType(body?.event);
        const metadata = { ...body };
        delete metadata.event;
        delete metadata.timestamp;

        await this.analyticsService.trackEvent(eventType, userId, metadata);
        return { ok: true };
    }

    @Get('dau')
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Get daily active users' })
    async getDau(@Query('date') date?: string) {
        const dau = await this.analyticsService.getDailyActiveUsers(date);
        return { date: date || new Date().toISOString().split('T')[0], dau };
    }

    @Get('conversion')
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Get like-to-match conversion rate' })
    async getConversion(@Query('days') days?: number) {
        return this.analyticsService.getLikeToMatchConversion(days || 30);
    }

    @Get('retention')
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Get user retention metrics' })
    async getRetention(@Query('cohortDays') cohortDays?: number) {
        return this.analyticsService.getUserRetention(cohortDays || 7);
    }

    @Get('matches-over-time')
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Get matches over time' })
    async getMatchesOverTime(@Query('days') days?: number) {
        return this.analyticsService.getMatchesOverTime(days || 30);
    }

    private mapEventType(rawEvent?: string): AnalyticsEventType {
        switch (rawEvent?.toString().trim().toLowerCase()) {
            case AnalyticsEventType.USER_SIGNUP:
                return AnalyticsEventType.USER_SIGNUP;
            case AnalyticsEventType.USER_LOGIN:
                return AnalyticsEventType.USER_LOGIN;
            case AnalyticsEventType.PROFILE_VIEW:
                return AnalyticsEventType.PROFILE_VIEW;
            case AnalyticsEventType.SWIPE_LIKE:
                return AnalyticsEventType.SWIPE_LIKE;
            case AnalyticsEventType.SWIPE_PASS:
                return AnalyticsEventType.SWIPE_PASS;
            case AnalyticsEventType.SWIPE_SUPER_LIKE:
                return AnalyticsEventType.SWIPE_SUPER_LIKE;
            case AnalyticsEventType.MATCH_CREATED:
                return AnalyticsEventType.MATCH_CREATED;
            case AnalyticsEventType.MESSAGE_SENT:
                return AnalyticsEventType.MESSAGE_SENT;
            case AnalyticsEventType.SUBSCRIPTION_PURCHASED:
                return AnalyticsEventType.SUBSCRIPTION_PURCHASED;
            case AnalyticsEventType.BOOST_PURCHASED:
                return AnalyticsEventType.BOOST_PURCHASED;
            case AnalyticsEventType.REPORT_CREATED:
                return AnalyticsEventType.REPORT_CREATED;
            case 'screen_view':
            case 'user_action':
            case AnalyticsEventType.USER_ACTIVE:
            default:
                return AnalyticsEventType.USER_ACTIVE;
        }
    }
}

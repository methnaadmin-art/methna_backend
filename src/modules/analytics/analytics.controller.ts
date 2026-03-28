import {
    Controller,
    Get,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities/user.entity';

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
    async getProfileAnalytics(@Query('userId') userId: string) {
        return this.analyticsService.getProfileAnalytics(userId);
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
}

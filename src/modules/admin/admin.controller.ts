import {
    Controller,
    Get,
    Post,
    Patch,
    Put,
    Delete,
    Param,
    Query,
    Body,
    UseGuards,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { RedisService } from '../redis/redis.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole, UserStatus } from '../../database/entities/user.entity';
import { ReportStatus } from '../../database/entities/report.entity';
import { PhotoModerationStatus } from '../../database/entities/photo.entity';
import { LikeType } from '../../database/entities/like.entity';
import { TicketStatus } from '../../database/entities/support-ticket.entity';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { IsEnum, IsOptional, IsString, IsEmail, IsBoolean, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class UpdateUserStatusDto {
    @ApiProperty({ enum: UserStatus })
    @IsEnum(UserStatus)
    status: UserStatus;
}

class ResolveReportDto {
    @ApiProperty({ enum: ReportStatus })
    @IsEnum(ReportStatus)
    status: ReportStatus;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    moderatorNote?: string;
}

class ModeratePhotoDto {
    @ApiProperty({ enum: PhotoModerationStatus })
    @IsEnum(PhotoModerationStatus)
    status: PhotoModerationStatus;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    moderationNote?: string;
}

class CreateUserDto {
    @ApiProperty() @IsEmail() email: string;
    @ApiProperty() @IsString() @MinLength(6) password: string;
    @ApiProperty() @IsString() firstName: string;
    @ApiProperty() @IsString() lastName: string;
    @ApiPropertyOptional({ enum: UserRole }) @IsOptional() @IsEnum(UserRole) role?: UserRole;
    @ApiPropertyOptional({ enum: UserStatus }) @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
}

class SendNotificationDto {
    @ApiPropertyOptional() @IsOptional() @IsString() userId?: string;
    @ApiProperty() @IsString() title: string;
    @ApiProperty() @IsString() body: string;
    @ApiPropertyOptional() @IsOptional() @IsString() type?: string;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() broadcast?: boolean;
}

class ReplyTicketDto {
    @ApiProperty() @IsString() reply: string;
    @ApiPropertyOptional({ enum: TicketStatus }) @IsOptional() @IsEnum(TicketStatus) status?: TicketStatus;
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MODERATOR)
@Controller('admin')
export class AdminController {
    constructor(
        private readonly adminService: AdminService,
        private readonly redisService: RedisService,
    ) { }

    // ─── USERS ──────────────────────────────────────────────

    @Get('users')
    @ApiOperation({ summary: 'List all users with search and filters' })
    async getUsers(
        @Query() pagination: PaginationDto,
        @Query('status') status?: UserStatus,
        @Query('search') search?: string,
        @Query('role') role?: UserRole,
        @Query('plan') plan?: string,
    ) {
        return this.adminService.getUsers(pagination, status, search, role, plan);
    }

    @Roles(UserRole.ADMIN)
    @Post('users')
    @ApiOperation({ summary: 'Create a new user (admin)' })
    async createUser(@Body() dto: CreateUserDto) {
        return this.adminService.createUser(dto);
    }

    @Get('users/:id')
    @ApiOperation({ summary: 'Get user detail with profile, photos, subscription' })
    async getUserDetail(@Param('id') userId: string) {
        return this.adminService.getUserDetail(userId);
    }

    @Get('users/:id/activity')
    @ApiOperation({ summary: 'Get per-user activity stats (likes, matches, messages, etc.)' })
    async getUserActivity(@Param('id') userId: string) {
        return this.adminService.getUserActivity(userId);
    }

    @Put('users/:id')
    @ApiOperation({ summary: 'Update user fields' })
    async updateUser(@Param('id') userId: string, @Body() dto: any) {
        return this.adminService.updateUser(userId, dto);
    }

    @Patch('users/:id/status')
    @ApiOperation({ summary: 'Update user status (ban/suspend/activate)' })
    async updateUserStatus(
        @CurrentUser('sub') adminId: string,
        @Param('id') userId: string,
        @Body() dto: UpdateUserStatusDto,
    ) {
        this.redisService.appendAuditLog({
            type: 'admin',
            adminId,
            action: 'update_user_status',
            targetUserId: userId,
            newStatus: dto.status,
        }).catch(() => {});
        return this.adminService.updateUserStatus(userId, dto.status);
    }

    // ─── DOCUMENT VERIFICATION ────────────────────────────────

    @Get('documents/pending')
    @ApiOperation({ summary: 'Get all users with pending document verification' })
    async getPendingDocuments() {
        return this.adminService.getPendingDocuments();
    }

    @Patch('documents/:userId/verify')
    @ApiOperation({ summary: 'Approve or reject a user document' })
    async verifyDocument(
        @CurrentUser('sub') adminId: string,
        @Param('userId') userId: string,
        @Body() dto: { approved: boolean; rejectionReason?: string },
    ) {
        this.redisService.appendAuditLog({
            type: 'admin',
            adminId,
            action: dto.approved ? 'approve_document' : 'reject_document',
            targetUserId: userId,
        }).catch(() => {});
        return this.adminService.verifyDocument(userId, dto.approved, dto.rejectionReason);
    }

    @Post('documents/auto-approve')
    @ApiOperation({ summary: 'Auto-approve all pending documents' })
    async autoApproveDocuments(@CurrentUser('sub') adminId: string) {
        this.redisService.appendAuditLog({
            type: 'admin',
            adminId,
            action: 'auto_approve_documents',
        }).catch(() => {});
        return this.adminService.autoApproveDocuments();
    }

    @Roles(UserRole.ADMIN)
    @Delete('users/:id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Soft-delete a user account' })
    async deleteUser(@CurrentUser('sub') adminId: string, @Param('id') userId: string) {
        this.redisService.appendAuditLog({
            type: 'admin',
            adminId,
            action: 'delete_user',
            targetUserId: userId,
        }).catch(() => {});
        await this.adminService.deleteUserAccount(userId);
    }

    @Roles(UserRole.ADMIN)
    @Post('users/:id/revoke-sessions')
    @ApiOperation({ summary: 'Force-revoke all sessions for a user' })
    async revokeUserSessions(@CurrentUser('sub') adminId: string, @Param('id') userId: string) {
        this.redisService.appendAuditLog({
            type: 'admin',
            adminId,
            action: 'revoke_user_sessions',
            targetUserId: userId,
        }).catch(() => {});
        await this.redisService.invalidateAllUserSessions(userId);
        return { message: `All sessions revoked for user ${userId}` };
    }

    // ─── SWIPES / ACTIVITY ──────────────────────────────────

    @Get('swipes')
    @ApiOperation({ summary: 'View all swipes (who liked/disliked/complimented who)' })
    async getSwipes(
        @Query() pagination: PaginationDto,
        @Query('type') type?: LikeType,
    ) {
        return this.adminService.getSwipes(pagination, type);
    }

    // ─── MATCHES ────────────────────────────────────────────

    @Get('matches')
    @ApiOperation({ summary: 'View all matches' })
    async getMatches(@Query() pagination: PaginationDto) {
        return this.adminService.getMatches(pagination);
    }

    // ─── CONVERSATIONS ──────────────────────────────────────

    @Get('conversations')
    @ApiOperation({ summary: 'View all conversations' })
    async getConversations(@Query() pagination: PaginationDto) {
        return this.adminService.getConversations(pagination);
    }

    @Get('conversations/:id/messages')
    @ApiOperation({ summary: 'View messages in a conversation' })
    async getConversationMessages(
        @Param('id') conversationId: string,
        @Query() pagination: PaginationDto,
    ) {
        return this.adminService.getConversationMessages(conversationId, pagination);
    }

    // ─── REPORTS ────────────────────────────────────────────

    @Get('reports')
    @ApiOperation({ summary: 'List all reports (admin only)' })
    async getReports(
        @Query() pagination: PaginationDto,
        @Query('status') status?: ReportStatus,
    ) {
        return this.adminService.getReports(pagination, status);
    }

    @Patch('reports/:id')
    @ApiOperation({ summary: 'Resolve a report' })
    async resolveReport(
        @CurrentUser('sub') adminId: string,
        @Param('id') reportId: string,
        @Body() dto: ResolveReportDto,
    ) {
        return this.adminService.resolveReport(reportId, adminId, dto.status, dto.moderatorNote);
    }

    // ─── PHOTO MODERATION ───────────────────────────────────

    @Get('photos/pending')
    @ApiOperation({ summary: 'List photos pending moderation' })
    async getPendingPhotos(@Query() pagination: PaginationDto) {
        return this.adminService.getPendingPhotos(pagination);
    }

    @Patch('photos/:id/moderate')
    @ApiOperation({ summary: 'Approve or reject a photo' })
    async moderatePhoto(@Param('id') photoId: string, @Body() dto: ModeratePhotoDto) {
        return this.adminService.moderatePhoto(photoId, dto.status, dto.moderationNote);
    }

    // ─── NOTIFICATIONS ──────────────────────────────────────

    @Post('notifications/send')
    @ApiOperation({ summary: 'Send notification to user or broadcast to all' })
    async sendNotification(@Body() dto: SendNotificationDto) {
        return this.adminService.sendNotification(dto);
    }

    // ─── SUPPORT TICKETS ────────────────────────────────────

    @Get('tickets')
    @ApiOperation({ summary: 'List support tickets' })
    async getTickets(
        @Query() pagination: PaginationDto,
        @Query('status') status?: TicketStatus,
    ) {
        return this.adminService.getTickets(pagination, status);
    }

    @Patch('tickets/:id/reply')
    @ApiOperation({ summary: 'Reply to a support ticket' })
    async replyToTicket(
        @CurrentUser('sub') adminId: string,
        @Param('id') ticketId: string,
        @Body() dto: ReplyTicketDto,
    ) {
        return this.adminService.replyToTicket(ticketId, adminId, dto.reply, dto.status);
    }

    // ─── ADS ────────────────────────────────────────────────

    @Get('ads')
    @ApiOperation({ summary: 'List all ads' })
    async getAds() {
        return this.adminService.getAds();
    }

    @Roles(UserRole.ADMIN)
    @Post('ads')
    @ApiOperation({ summary: 'Create a new ad' })
    async createAd(@Body() dto: any) {
        return this.adminService.createAd(dto);
    }

    @Roles(UserRole.ADMIN)
    @Patch('ads/:id')
    @ApiOperation({ summary: 'Update an ad' })
    async updateAd(@Param('id') id: string, @Body() dto: any) {
        return this.adminService.updateAd(id, dto);
    }

    @Roles(UserRole.ADMIN)
    @Delete('ads/:id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Delete an ad' })
    async deleteAd(@Param('id') id: string) {
        await this.adminService.deleteAd(id);
    }

    // ─── BOOSTS ─────────────────────────────────────────────

    @Get('boosts')
    @ApiOperation({ summary: 'List all profile boosts' })
    async getBoosts(@Query() pagination: PaginationDto) {
        return this.adminService.getBoosts(pagination);
    }

    // ─── PLANS ──────────────────────────────────────────────

    @Get('plans')
    @ApiOperation({ summary: 'List all subscription plans' })
    async getPlans() {
        return this.adminService.getPlans();
    }

    @Roles(UserRole.ADMIN)
    @Post('plans')
    @ApiOperation({ summary: 'Create a new subscription plan' })
    async createPlan(@Body() dto: any) {
        return this.adminService.createPlan(dto);
    }

    @Roles(UserRole.ADMIN)
    @Put('plans/:id')
    @ApiOperation({ summary: 'Update a subscription plan' })
    async updatePlan(@Param('id') id: string, @Body() dto: any) {
        return this.adminService.updatePlan(id, dto);
    }

    @Roles(UserRole.ADMIN)
    @Delete('plans/:id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Delete a subscription plan' })
    async deletePlan(@Param('id') id: string) {
        return this.adminService.deletePlan(id);
    }

    @Roles(UserRole.ADMIN)
    @Post('users/:id/subscription/override')
    @ApiOperation({ summary: 'Override user subscription plan manually' })
    async overrideUserSubscription(
        @Param('id') userId: string,
        @Body() dto: { planId: string; durationDays: number },
    ) {
        return this.adminService.overrideUserSubscription(userId, dto.planId, dto.durationDays);
    }

    // ─── SUBSCRIPTIONS ──────────────────────────────────────

    @Get('subscriptions')
    @ApiOperation({ summary: 'List all subscriptions with plan breakdown' })
    async getSubscriptions(
        @Query() pagination: PaginationDto,
        @Query('plan') plan?: string,
    ) {
        return this.adminService.getSubscriptions(pagination, plan);
    }

    // ─── ANALYTICS ──────────────────────────────────────────

    @Get('stats')
    @ApiOperation({ summary: 'Get dashboard statistics' })
    async getDashboardStats() {
        return this.adminService.getDashboardStats();
    }

    // ─── SYSTEM HEALTH / PERFORMANCE ─────────────────────────

    @Roles(UserRole.ADMIN)
    @Get('system/health')
    @ApiOperation({ summary: 'System health: cache stats, uptime, memory' })
    async getSystemHealth() {
        const cacheStats = this.redisService.getCacheStats();
        const memUsage = process.memoryUsage();
        return {
            status: 'ok',
            uptime: Math.round(process.uptime()),
            redis: cacheStats,
            memory: {
                rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
                heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
                heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
            },
            timestamp: new Date().toISOString(),
        };
    }

    @Roles(UserRole.ADMIN)
    @Get('audit-logs/:type')
    @ApiOperation({ summary: 'View audit logs by type (login, admin, suspicious)' })
    async getAuditLogs(
        @Param('type') type: string,
        @Query('count') count?: number,
    ) {
        return this.redisService.getAuditLogs(type, count || 100);
    }

    @Roles(UserRole.ADMIN)
    @Get('audit-logs')
    @ApiOperation({ summary: 'View all audit log types' })
    async getAllAuditLogs() {
        const [login, admin, suspicious] = await Promise.all([
            this.redisService.getAuditLogs('login', 50),
            this.redisService.getAuditLogs('admin', 50),
            this.redisService.getAuditLogs('suspicious', 50),
        ]);
        return { login, admin, suspicious };
    }
}

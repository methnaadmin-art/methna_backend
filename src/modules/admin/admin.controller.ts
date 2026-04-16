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
import { UserRole, UserStatus, ModerationReasonCode, ActionRequired } from '../../database/entities/user.entity';
import { ReportStatus } from '../../database/entities/report.entity';
import { PhotoModerationStatus } from '../../database/entities/photo.entity';
import { LikeType } from '../../database/entities/like.entity';
import { TicketStatus, TicketPriority } from '../../database/entities/support-ticket.entity';
import { SubscriptionStatus } from '../../database/entities/subscription.entity';
import { PaginationDto } from '../../common/dto/pagination.dto';
import {
    IsEnum,
    IsOptional,
    IsString,
    IsEmail,
    IsBoolean,
    IsInt,
    IsIn,
    MinLength,
    Min,
    Max,
    IsDateString,
    IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { VerificationStatus } from '../../database/entities/user.entity';

class UpdateUserStatusDto {
    @ApiProperty({ enum: UserStatus })
    @IsEnum(UserStatus)
    status: UserStatus;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    reason?: string;

    @ApiPropertyOptional({ enum: ModerationReasonCode })
    @IsOptional()
    @IsEnum(ModerationReasonCode)
    moderationReasonCode?: ModerationReasonCode;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    moderationReasonText?: string;

    @ApiPropertyOptional({ enum: ActionRequired })
    @IsOptional()
    @IsEnum(ActionRequired)
    actionRequired?: ActionRequired;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    supportMessage?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isUserVisible?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    expiresAt?: string;

    @ApiProperty({ description: 'Required when status is not active. Explains why the action was taken.' })
    @IsString()
    internalAdminNote: string;
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
    @ApiPropertyOptional() @IsOptional() @IsString() username?: string;
    @ApiPropertyOptional({ enum: UserRole }) @IsOptional() @IsEnum(UserRole) role?: UserRole;
    @ApiPropertyOptional({ enum: UserStatus }) @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
}

class SendNotificationDto {
    @ApiPropertyOptional() @IsOptional() @IsString() userId?: string;
    @ApiProperty() @IsString() title: string;
    @ApiProperty() @IsString() body: string;
    @ApiPropertyOptional() @IsOptional() @IsString() type?: string;
    @ApiPropertyOptional() @IsOptional() @IsString() conversationId?: string;
    @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() extraData?: Record<string, any>;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() broadcast?: boolean;
    @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() filters?: Record<string, any>;
}

class ReplyTicketDto {
    @ApiProperty() @IsString() reply: string;
    @ApiPropertyOptional({ enum: TicketStatus }) @IsOptional() @IsEnum(TicketStatus) status?: TicketStatus;
}

class SetUserPremiumDto {
    @ApiProperty()
    @IsDateString()
    startDate: string;

    @ApiProperty()
    @IsDateString()
    expiryDate: string;
}

class VerificationModerationDto {
    @ApiProperty({ enum: VerificationStatus })
    @IsEnum(VerificationStatus)
    status: VerificationStatus;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    rejectionReason?: string;
}

const SORT_ORDERS = ['asc', 'desc'] as const;
const USER_PREMIUM_STATES = ['all', 'premium', 'not_premium', 'expired'] as const;
const USER_VERIFICATION_STATES = ['all', 'pending', 'approved', 'rejected'] as const;
const VERIFICATION_TYPES = ['all', 'selfie', 'identity', 'marital_status'] as const;

class AdminUsersQueryDto extends PaginationDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    search?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    query?: string;

    @ApiPropertyOptional({ enum: UserStatus })
    @IsOptional()
    @IsEnum(UserStatus)
    status?: UserStatus;

    @ApiPropertyOptional({ enum: UserRole })
    @IsOptional()
    @IsEnum(UserRole)
    role?: UserRole;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    plan?: string;

    @ApiPropertyOptional({ enum: USER_PREMIUM_STATES })
    @IsOptional()
    @IsIn(USER_PREMIUM_STATES)
    premiumState?: (typeof USER_PREMIUM_STATES)[number];

    @ApiPropertyOptional({ enum: USER_VERIFICATION_STATES })
    @IsOptional()
    @IsIn(USER_VERIFICATION_STATES)
    verificationState?: (typeof USER_VERIFICATION_STATES)[number];

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    dateFrom?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    dateTo?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    sortBy?: string;

    @ApiPropertyOptional({ enum: SORT_ORDERS })
    @IsOptional()
    @IsIn(SORT_ORDERS)
    sortOrder?: (typeof SORT_ORDERS)[number];
}

class AdminVerificationQueryDto extends PaginationDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    search?: string;

    @ApiPropertyOptional({ enum: USER_VERIFICATION_STATES })
    @IsOptional()
    @IsIn(USER_VERIFICATION_STATES)
    status?: (typeof USER_VERIFICATION_STATES)[number];

    @ApiPropertyOptional({ enum: VERIFICATION_TYPES })
    @IsOptional()
    @IsIn(VERIFICATION_TYPES)
    type?: (typeof VERIFICATION_TYPES)[number];

    @ApiPropertyOptional({ enum: UserStatus })
    @IsOptional()
    @IsEnum(UserStatus)
    userStatus?: UserStatus;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    dateFrom?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    dateTo?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    sortBy?: string;

    @ApiPropertyOptional({ enum: SORT_ORDERS })
    @IsOptional()
    @IsIn(SORT_ORDERS)
    sortOrder?: (typeof SORT_ORDERS)[number];
}

class AdminNotificationsQueryDto extends PaginationDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    search?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    userId?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    type?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    isRead?: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    dateFrom?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    dateTo?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    sortBy?: string;

    @ApiPropertyOptional({ enum: SORT_ORDERS })
    @IsOptional()
    @IsIn(SORT_ORDERS)
    sortOrder?: (typeof SORT_ORDERS)[number];
}

class AdminTicketsQueryDto extends PaginationDto {
    @ApiPropertyOptional({ enum: TicketStatus })
    @IsOptional()
    @IsEnum(TicketStatus)
    status?: TicketStatus;

    @ApiPropertyOptional({ enum: TicketPriority })
    @IsOptional()
    @IsEnum(TicketPriority)
    priority?: TicketPriority;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    search?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    userId?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    assignedToId?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    dateFrom?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    dateTo?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    sortBy?: string;

    @ApiPropertyOptional({ enum: SORT_ORDERS })
    @IsOptional()
    @IsIn(SORT_ORDERS)
    sortOrder?: (typeof SORT_ORDERS)[number];
}

class AdminSubscriptionsQueryDto extends PaginationDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    plan?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    userId?: string;

    @ApiPropertyOptional({ enum: SubscriptionStatus })
    @IsOptional()
    @IsEnum(SubscriptionStatus)
    status?: SubscriptionStatus;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    search?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    dateFrom?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsDateString()
    dateTo?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    sortBy?: string;

    @ApiPropertyOptional({ enum: SORT_ORDERS })
    @IsOptional()
    @IsIn(SORT_ORDERS)
    sortOrder?: (typeof SORT_ORDERS)[number];
}

class UserActionsQueryDto extends PaginationDto {
    @ApiPropertyOptional({ default: 1, minimum: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1;

    @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 100 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number = 30;
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

    // â”€â”€â”€ USERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @Get('users')
    @ApiOperation({ summary: 'List all users with search and filters' })
    async getUsers(@Query() query: AdminUsersQueryDto) {
        const searchText = (query.search || query.query || '').trim() || undefined;
        return this.adminService.getUsers(query, {
            status: query.status,
            search: searchText,
            role: query.role,
            plan: query.plan,
            premiumState: query.premiumState,
            verificationState: query.verificationState,
            dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
            dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
            sortBy: query.sortBy,
            sortOrder: query.sortOrder,
        });
    }

    @Get('search/users')
    @ApiOperation({ summary: 'Search users by name, email, or userId' })
    async searchUsersLegacy(@Query() query: AdminUsersQueryDto) {
        return this.handleUserSearch(query);
    }

    @Get('users/search')
    @ApiOperation({ summary: 'Search users by name, email, or userId' })
    async searchUsers(@Query() query: AdminUsersQueryDto) {
        return this.handleUserSearch(query);
    }

    private handleUserSearch(query: AdminUsersQueryDto) {
        const searchText = (query.query || query.search || '').trim();
        return this.adminService.searchUsers(searchText, query, {
            status: query.status,
            role: this.normalizeRoleInput(query.role),
            plan: query.plan,
            premiumState: query.premiumState,
            verificationState: query.verificationState,
            dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
            dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
            sortBy: query.sortBy,
            sortOrder: query.sortOrder,
        });
    }

    @Roles(UserRole.ADMIN)
    @Post('users')
    @ApiOperation({ summary: 'Create a new user (admin)' })
    async createUser(@Body() dto: CreateUserDto) {
        return this.adminService.createUser({
            ...dto,
            role: this.normalizeRoleInput(dto.role),
        });
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

    @Get('users/:id/subscription-history')
    @ApiOperation({ summary: 'Get user subscription history' })
    async getUserSubscriptionHistory(@Param('id') userId: string) {
        return this.adminService.getUserSubscriptionHistory(userId);
    }

    @Get('users/:id/actions')
    @ApiOperation({ summary: 'Get admin/staff action timeline for a user' })
    async getUserActions(
        @Param('id') userId: string,
        @Query() pagination: UserActionsQueryDto,
    ) {
        return this.adminService.getUserActions(userId, pagination);
    }

    @Roles(UserRole.ADMIN)
    @Patch('users/:id')
    @ApiOperation({ summary: 'Update user fields' })
    async updateUser(@Param('id') userId: string, @Body() dto: any) {
        return this.updateUserFields(userId, dto);
    }

    @Roles(UserRole.ADMIN)
    @Put('users/:id')
    @ApiOperation({ summary: 'Replace user fields' })
    async replaceUser(@Param('id') userId: string, @Body() dto: any) {
        return this.updateUserFields(userId, dto);
    }

    private updateUserFields(userId: string, dto: any) {
        return this.adminService.updateUser(userId, dto);
    }

    @Roles(UserRole.ADMIN)
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
        return this.adminService.updateUserStatus(userId, dto.status, {
            reason: dto.reason,
            moderationReasonCode: dto.moderationReasonCode,
            moderationReasonText: dto.moderationReasonText,
            actionRequired: dto.actionRequired,
            supportMessage: dto.supportMessage,
            isUserVisible: dto.isUserVisible,
            expiresAt: dto.expiresAt,
            internalAdminNote: dto.internalAdminNote,
            updatedByAdminId: adminId,
        });
    }

    @Roles(UserRole.ADMIN)
    @Post('users/:id/premium')
    @ApiOperation({ summary: 'Set user premium access manually' })
    async setUserPremium(
        @CurrentUser('sub') adminId: string,
        @Param('id') userId: string,
        @Body() dto: SetUserPremiumDto,
    ) {
        this.redisService.appendAuditLog({
            type: 'admin',
            adminId,
            action: 'set_user_premium',
            targetUserId: userId,
            startDate: dto.startDate,
            expiryDate: dto.expiryDate,
        }).catch(() => {});

        return this.adminService.setUserPremium(
            userId,
            new Date(dto.startDate),
            new Date(dto.expiryDate),
        );
    }

    @Roles(UserRole.ADMIN)
    @Delete('users/:id/premium')
    @ApiOperation({ summary: 'Remove user premium access manually' })
    async removeUserPremium(
        @CurrentUser('sub') adminId: string,
        @Param('id') userId: string,
    ) {
        this.redisService.appendAuditLog({
            type: 'admin',
            adminId,
            action: 'remove_user_premium',
            targetUserId: userId,
        }).catch(() => {});

        return this.adminService.removeUserPremium(userId);
    }

    @Roles(UserRole.ADMIN)
    @Patch('users/:id/verification/selfie')
    @ApiOperation({ summary: 'Approve or reject selfie verification' })
    async verifySelfie(
        @CurrentUser('sub') adminId: string,
        @Param('id') userId: string,
        @Body() dto: VerificationModerationDto,
    ) {
        this.redisService.appendAuditLog({
            type: 'admin',
            adminId,
            action: 'verify_selfie',
            targetUserId: userId,
            status: dto.status,
        }).catch(() => {});

        return this.adminService.verifySelfie(
            userId,
            dto.status,
            adminId,
            dto.rejectionReason,
        );
    }

    @Roles(UserRole.ADMIN)
    @Patch('users/:id/verification/marital-status')
    @ApiOperation({ summary: 'Approve or reject marital-status verification' })
    async verifyMaritalStatus(
        @CurrentUser('sub') adminId: string,
        @Param('id') userId: string,
        @Body() dto: VerificationModerationDto,
    ) {
        this.redisService.appendAuditLog({
            type: 'admin',
            adminId,
            action: 'verify_marital_status',
            targetUserId: userId,
            status: dto.status,
        }).catch(() => {});

        return this.adminService.verifyMaritalStatus(
            userId,
            dto.status,
            adminId,
            dto.rejectionReason,
        );
    }

    // â”€â”€â”€ DOCUMENT VERIFICATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @Get('documents/pending')
    @ApiOperation({ summary: 'Get all users with pending document verification' })
    async getPendingDocuments() {
        return this.adminService.getPendingDocuments();
    }

    @Get('verifications')
    @ApiOperation({ summary: 'List verification queue with filters and search' })
    async getVerifications(@Query() query: AdminVerificationQueryDto) {
        return this.adminService.getVerifications(query, {
            search: query.search,
            status: query.status,
            type: query.type,
            userStatus: query.userStatus,
            dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
            dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
            sortBy: query.sortBy,
            sortOrder: query.sortOrder,
        });
    }

    @Get('verifications/pending')
    @ApiOperation({ summary: 'Get all users with pending selfie or marital-status verification' })
    async getPendingVerifications(@Query() query: AdminVerificationQueryDto) {
        return this.adminService.getVerifications(query, {
            search: query.search,
            status: 'pending',
            type: query.type,
            userStatus: query.userStatus,
            dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
            dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
            sortBy: query.sortBy,
            sortOrder: query.sortOrder,
        });
    }

    @Patch('documents/:userId/verify')
    @ApiOperation({ summary: 'Approve a user document or request reverify' })
    async verifyDocument(
        @CurrentUser('sub') adminId: string,
        @Param('userId') userId: string,
        @Body() dto: { approved: boolean; rejectionReason?: string },
    ) {
        this.redisService.appendAuditLog({
            type: 'admin',
            adminId,
            action: dto.approved ? 'approve_document' : 'request_document_reverify',
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

    // â”€â”€â”€ SWIPES / ACTIVITY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @Get('swipes')
    @ApiOperation({ summary: 'View all swipes (who liked/disliked/complimented who)' })
    async getSwipes(
        @Query() pagination: PaginationDto,
        @Query('type') type?: LikeType,
    ) {
        return this.adminService.getSwipes(pagination, type);
    }

    // â”€â”€â”€ MATCHES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @Get('matches')
    @ApiOperation({ summary: 'View all matches' })
    async getMatches(@Query() pagination: PaginationDto) {
        return this.adminService.getMatches(pagination);
    }

    // â”€â”€â”€ CONVERSATIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @Get('conversations')
    @ApiOperation({ summary: 'View all conversations with optional search' })
    async getConversations(
        @Query() pagination: PaginationDto,
        @Query('search') search?: string,
        @Query('locked') locked?: string,
        @Query('flagged') flagged?: string,
    ) {
        const filters: { locked?: boolean; flagged?: boolean } = {};
        if (locked === 'true') filters.locked = true;
        if (flagged === 'true') filters.flagged = true;
        return this.adminService.getConversations(pagination, search, Object.keys(filters).length > 0 ? filters : undefined);
    }

    @Get('conversations/:id/messages')
    @ApiOperation({ summary: 'View messages in a conversation with optional search' })
    async getConversationMessages(
        @Param('id') conversationId: string,
        @Query() pagination: PaginationDto,
        @Query('search') search?: string,
    ) {
        return this.adminService.getConversationMessages(conversationId, pagination, search);
    }

    @Patch('conversations/:id/lock')
    @ApiOperation({ summary: 'Lock or unlock a conversation' })
    async lockConversation(
        @CurrentUser('sub') adminId: string,
        @Param('id') conversationId: string,
        @Body() dto: { isLocked: boolean; lockReason?: string },
    ) {
        this.redisService.appendAuditLog({
            type: 'admin',
            adminId,
            action: dto.isLocked ? 'lock_conversation' : 'unlock_conversation',
            targetUserId: conversationId,
            details: dto.lockReason || '',
        }).catch(() => {});
        return this.adminService.lockConversation(conversationId, dto.isLocked, dto.lockReason);
    }

    @Patch('conversations/:id/flag')
    @ApiOperation({ summary: 'Flag or unflag a conversation' })
    async flagConversation(
        @CurrentUser('sub') adminId: string,
        @Param('id') conversationId: string,
        @Body() dto: { isFlagged: boolean; flagReason?: string },
    ) {
        this.redisService.appendAuditLog({
            type: 'admin',
            adminId,
            action: dto.isFlagged ? 'flag_conversation' : 'unflag_conversation',
            targetUserId: conversationId,
            details: dto.flagReason || '',
        }).catch(() => {});
        return this.adminService.flagConversation(conversationId, dto.isFlagged, dto.flagReason);
    }

    // â”€â”€â”€ REPORTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    // â”€â”€â”€ PHOTO MODERATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    // â”€â”€â”€ NOTIFICATIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @Get('notifications')
    @ApiOperation({ summary: 'List sent notifications with search and filters' })
    async getNotifications(@Query() query: AdminNotificationsQueryDto) {
        return this.adminService.getAdminNotifications(query, {
            search: query.search,
            userId: query.userId,
            type: query.type,
            isRead: query.isRead,
            dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
            dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
            sortBy: query.sortBy,
            sortOrder: query.sortOrder,
        });
    }

    @Roles(UserRole.ADMIN)
    @Post('notifications/send')
    @ApiOperation({ summary: 'Send notification to user or broadcast to all' })
    async sendNotification(
        @CurrentUser('sub') adminId: string,
        @Body() dto: SendNotificationDto,
    ) {
        this.redisService.appendAuditLog({
            type: 'admin',
            adminId,
            action: 'send_notification',
            targetUserId: dto.userId,
            notificationType: dto.type,
            broadcast: dto.broadcast ?? false,
        }).catch(() => {});
        return this.adminService.sendNotification(dto);
    }

    @Roles(UserRole.ADMIN)
    @Post('notifications/preview')
    @ApiOperation({ summary: 'Preview recipient count for filtered broadcast' })
    async previewNotificationRecipients(@Body() filters: Record<string, any>) {
        return this.adminService.previewNotificationRecipients(filters);
    }

    // â”€â”€â”€ SUPPORT TICKETS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @Get('tickets')
    @ApiOperation({ summary: 'List support tickets' })
    async getTickets(@Query() query: AdminTicketsQueryDto) {
        return this.adminService.getTickets(query, {
            status: query.status,
            priority: query.priority,
            search: query.search,
            userId: query.userId,
            assignedToId: query.assignedToId,
            dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
            dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
            sortBy: query.sortBy,
            sortOrder: query.sortOrder,
        });
    }

    @Patch('tickets/:id/reply')
    @ApiOperation({ summary: 'Reply to a support ticket' })
    async replyToTicket(
        @CurrentUser('sub') adminId: string,
        @Param('id') ticketId: string,
        @Body() dto: ReplyTicketDto,
    ) {
        this.redisService.appendAuditLog({
            type: 'admin',
            adminId,
            action: 'reply_ticket',
            ticketId,
            status: dto.status,
        }).catch(() => {});
        return this.adminService.replyToTicket(ticketId, adminId, dto.reply, dto.status);
    }

    // â”€â”€â”€ ADS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    // â”€â”€â”€ BOOSTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @Get('boosts')
    @ApiOperation({ summary: 'List all profile boosts' })
    async getBoosts(@Query() pagination: PaginationDto) {
        return this.adminService.getBoosts(pagination);
    }

    // â”€â”€â”€ PLANS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    // â”€â”€â”€ SUBSCRIPTIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @Get('subscriptions')
    @ApiOperation({ summary: 'List all subscriptions with plan breakdown' })
    async getSubscriptions(@Query() query: AdminSubscriptionsQueryDto) {
        return this.adminService.getSubscriptions(query, {
            plan: query.plan,
            userId: query.userId,
            status: query.status,
            search: query.search,
            dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
            dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
            sortBy: query.sortBy,
            sortOrder: query.sortOrder,
        });
    }

    // â”€â”€â”€ ANALYTICS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @Get('stats')
    @ApiOperation({ summary: 'Get dashboard statistics' })
    async getDashboardStats() {
        return this.adminService.getDashboardStats();
    }

    // â”€â”€â”€ SYSTEM HEALTH / PERFORMANCE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    private normalizeRoleInput(role?: string | UserRole): UserRole | undefined {
        if (!role) {
            return undefined;
        }

        const normalized = role.toString().trim().toLowerCase();
        if (normalized === 'staff') {
            return UserRole.MODERATOR;
        }
        if (Object.values(UserRole).includes(normalized as UserRole)) {
            return normalized as UserRole;
        }

        return undefined;
    }
}


import {
    Controller,
    Get,
    Patch,
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole, UserStatus } from '../../database/entities/user.entity';
import { ReportStatus } from '../../database/entities/report.entity';
import { PhotoModerationStatus } from '../../database/entities/photo.entity';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { IsEnum, IsOptional, IsString } from 'class-validator';
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

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
    constructor(private readonly adminService: AdminService) { }

    // ─── USERS ──────────────────────────────────────────────

    @Get('users')
    @ApiOperation({ summary: 'List all users (admin only)' })
    async getUsers(
        @Query() pagination: PaginationDto,
        @Query('status') status?: UserStatus,
    ) {
        return this.adminService.getUsers(pagination, status);
    }

    @Get('users/:id')
    @ApiOperation({ summary: 'Get user detail with profile, photos, subscription' })
    async getUserDetail(@Param('id') userId: string) {
        return this.adminService.getUserDetail(userId);
    }

    @Patch('users/:id/status')
    @ApiOperation({ summary: 'Update user status (ban/suspend/activate)' })
    async updateUserStatus(
        @Param('id') userId: string,
        @Body() dto: UpdateUserStatusDto,
    ) {
        return this.adminService.updateUserStatus(userId, dto.status);
    }

    @Delete('users/:id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Soft-delete a user account' })
    async deleteUser(@Param('id') userId: string) {
        await this.adminService.deleteUserAccount(userId);
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
        return this.adminService.resolveReport(
            reportId,
            adminId,
            dto.status,
            dto.moderatorNote,
        );
    }

    // ─── PHOTO MODERATION ───────────────────────────────────

    @Get('photos/pending')
    @ApiOperation({ summary: 'List photos pending moderation' })
    async getPendingPhotos(@Query() pagination: PaginationDto) {
        return this.adminService.getPendingPhotos(pagination);
    }

    @Patch('photos/:id/moderate')
    @ApiOperation({ summary: 'Approve or reject a photo' })
    async moderatePhoto(
        @Param('id') photoId: string,
        @Body() dto: ModeratePhotoDto,
    ) {
        return this.adminService.moderatePhoto(photoId, dto.status, dto.moderationNote);
    }

    // ─── ANALYTICS ──────────────────────────────────────────

    @Get('stats')
    @ApiOperation({ summary: 'Get dashboard statistics' })
    async getDashboardStats() {
        return this.adminService.getDashboardStats();
    }
}

import {
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Query,
    UseGuards,
} from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiOperation,
    ApiProperty,
    ApiPropertyOptional,
    ApiTags,
} from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
    UserRole,
    UserStatus,
    VerificationStatus,
} from '../../database/entities/user.entity';
import { ReportStatus } from '../../database/entities/report.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminService } from './admin.service';

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

class VerificationModerationDto {
    @ApiProperty({ enum: VerificationStatus })
    @IsEnum(VerificationStatus)
    status: VerificationStatus;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    rejectionReason?: string;
}

class VerifyDocumentDto {
    @ApiProperty()
    @IsBoolean()
    approved: boolean;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    rejectionReason?: string;
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
    constructor(private readonly adminService: AdminService) {}

    @Get('users')
    @ApiOperation({ summary: 'List all users (admin only)' })
    async getUsers(
        @Query() pagination: PaginationDto,
        @Query('status') status?: UserStatus,
    ) {
        return this.adminService.getUsers(pagination, status);
    }

    @Patch('users/:id/status')
    @ApiOperation({ summary: 'Update user status (ban/suspend/activate)' })
    async updateUserStatus(
        @Param('id') userId: string,
        @Body() dto: UpdateUserStatusDto,
    ) {
        return this.adminService.updateUserStatus(userId, dto.status);
    }

    @Get('verifications')
    @ApiOperation({ summary: 'List selfie and document verification queues' })
    async getVerifications(
        @Query() pagination: PaginationDto,
        @Query('status') status?: string,
        @Query('type') type?: string,
        @Query('search') search?: string,
    ) {
        return this.adminService.getVerifications(pagination, {
            status,
            type,
            search,
        });
    }

    @Get('verifications/pending')
    @ApiOperation({ summary: 'Get pending selfie and document verification items' })
    async getPendingVerifications() {
        return this.adminService.getPendingVerifications();
    }

    @Get('documents/pending')
    @ApiOperation({ summary: 'Get pending document verification items' })
    async getPendingDocuments() {
        return this.adminService.getPendingDocuments();
    }

    @Patch('users/:id/verification/selfie')
    @ApiOperation({ summary: 'Approve or reject a selfie verification' })
    async verifySelfie(
        @CurrentUser('sub') adminId: string,
        @Param('id') userId: string,
        @Body() dto: VerificationModerationDto,
    ) {
        return this.adminService.verifySelfie(
            userId,
            dto.status,
            adminId,
            dto.rejectionReason,
        );
    }

    @Patch('users/:id/verification/marital-status')
    @ApiOperation({ summary: 'Approve or reject a marital document verification' })
    async verifyMaritalStatus(
        @CurrentUser('sub') adminId: string,
        @Param('id') userId: string,
        @Body() dto: VerificationModerationDto,
    ) {
        return this.adminService.verifyMaritalStatus(
            userId,
            dto.status,
            adminId,
            dto.rejectionReason,
        );
    }

    @Patch('documents/:userId/verify')
    @ApiOperation({ summary: 'Approve or reject a document verification' })
    async verifyDocument(
        @CurrentUser('sub') adminId: string,
        @Param('userId') userId: string,
        @Body() dto: VerifyDocumentDto,
    ) {
        return this.adminService.verifyDocument(
            userId,
            dto.approved,
            adminId,
            dto.rejectionReason,
        );
    }

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

    @Get('stats')
    @ApiOperation({ summary: 'Get dashboard statistics' })
    async getDashboardStats() {
        return this.adminService.getDashboardStats();
    }
}

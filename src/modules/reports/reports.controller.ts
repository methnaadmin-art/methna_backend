import {
    Controller,
    Post,
    Get,
    Patch,
    Delete,
    Param,
    Body,
    Query,
    UseGuards,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { CreateReportDto, UpdateReportStatusDto } from './dto/report.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../database/entities/user.entity';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
    constructor(private readonly reportsService: ReportsService) { }

    @Post()
    @ApiOperation({ summary: 'Submit a report or feedback' })
    async createReport(
        @CurrentUser('sub') userId: string,
        @Body() dto: CreateReportDto,
    ) {
        return this.reportsService.createReport(userId, dto);
    }

    @Get('my-reports')
    @ApiOperation({ summary: 'Get my submitted reports and feedback' })
    async getMyReports(@CurrentUser('sub') userId: string) {
        return this.reportsService.getMyReports(userId);
    }

    // ─── Admin ─────────────────────────────────────────────
    @Get('admin/all')
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Get all reports (admin)' })
    @ApiQuery({ name: 'page', required: false })
    @ApiQuery({ name: 'limit', required: false })
    async getAllReports(
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.reportsService.getAllReports(
            parseInt(page || '1', 10),
            parseInt(limit || '20', 10),
        );
    }

    @Patch('admin/:id/status')
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Update report status (admin)' })
    async updateStatus(
        @Param('id') id: string,
        @Body() dto: UpdateReportStatusDto,
    ) {
        return this.reportsService.updateReportStatus(id, dto);
    }

    // ─── Blocking ──────────────────────────────────────────
    @Post('block/:id')
    @ApiOperation({ summary: 'Block a user' })
    async blockUser(
        @CurrentUser('sub') userId: string,
        @Param('id') blockedId: string,
    ) {
        return this.reportsService.blockUser(userId, blockedId);
    }

    @Delete('block/:id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Unblock a user' })
    async unblockUser(
        @CurrentUser('sub') userId: string,
        @Param('id') blockedId: string,
    ) {
        return this.reportsService.unblockUser(userId, blockedId);
    }

    @Get('blocked')
    @ApiOperation({ summary: 'Get blocked users list' })
    async getBlockedUsers(@CurrentUser('sub') userId: string) {
        return this.reportsService.getBlockedUsers(userId);
    }
}

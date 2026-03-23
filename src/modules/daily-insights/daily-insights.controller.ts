import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DailyInsightsService } from './daily-insights.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities/user.entity';

@ApiTags('daily-insights')
@Controller('daily-insights')
export class DailyInsightsController {
    constructor(private readonly insightsService: DailyInsightsService) { }

    @Get('today')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get today\'s daily halal insight' })
    async getTodayInsight() {
        return this.insightsService.getTodayInsight();
    }

    // ─── Admin endpoints ─────────────────────────────────────

    @Get()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Admin: List all insights' })
    async findAll(@Query('page') page?: number, @Query('limit') limit?: number) {
        return this.insightsService.findAll(page || 1, limit || 20);
    }

    @Post()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Admin: Create new insight' })
    async create(@Body() body: { content: string; author?: string; category?: string; scheduledDate?: string }) {
        return this.insightsService.create({
            content: body.content,
            author: body.author,
            category: body.category || 'general',
            scheduledDate: body.scheduledDate ? new Date(body.scheduledDate) : undefined,
        });
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Admin: Update insight' })
    async update(@Param('id') id: string, @Body() body: Partial<{ content: string; author: string; category: string; scheduledDate: string; isActive: boolean }>) {
        return this.insightsService.update(id, {
            ...body,
            scheduledDate: body.scheduledDate ? new Date(body.scheduledDate) : undefined,
        } as any);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Admin: Delete insight' })
    async remove(@Param('id') id: string) {
        return this.insightsService.remove(id);
    }

    @Post('seed')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Admin: Seed default insights' })
    async seed() {
        const count = await this.insightsService.seed();
        return { seeded: count };
    }
}

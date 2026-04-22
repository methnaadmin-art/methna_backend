import { Controller, Get, Post, Param, Query, UseGuards, Request, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProfileViewsService } from './profile-views.service';

@ApiTags('profile-views')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('profile-views')
export class ProfileViewsController {
    constructor(private readonly profileViewsService: ProfileViewsService) { }

    @Post(':userId')
    async recordView(
        @Request() req,
        @Param('userId', new ParseUUIDPipe({ version: '4' })) viewedId: string,
    ) {
        await this.profileViewsService.recordView(req.user.id, viewedId);
        return { recorded: true };
    }

    @Get('my-viewers')
    async getMyViewers(
        @Request() req,
        @Query('page') page?: number,
        @Query('limit') limit?: number,
    ) {
        return this.profileViewsService.getMyViewers(req.user.id, 30, page || 1, limit || 20);
    }

    @Get('count')
    async getViewCount(@Request() req) {
        const count = await this.profileViewsService.getViewCount(req.user.id);
        return { count };
    }
}

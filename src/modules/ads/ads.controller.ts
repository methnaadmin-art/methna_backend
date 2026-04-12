import {
    Controller,
    Get,
    Post,
    Param,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdsService } from './ads.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('ads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ads')
export class AdsController {
    constructor(private readonly adsService: AdsService) { }

    @Get('feed')
    @ApiOperation({ summary: 'Get ad cards for feed insertion (separate list)' })
    async getFeedAds(
        @CurrentUser('sub') userId: string,
        @Query('limit') limit?: number,
    ) {
        return this.adsService.getFeedAdCards(userId, limit ? Number(limit) : 5);
    }

    @Post(':id/impression')
    @ApiOperation({ summary: 'Track ad impression' })
    async trackImpression(@Param('id') adId: string) {
        await this.adsService.trackImpression(adId);
        return { tracked: true };
    }

    @Post(':id/click')
    @ApiOperation({ summary: 'Track ad click' })
    async trackClick(@Param('id') adId: string) {
        await this.adsService.trackClick(adId);
        return { tracked: true };
    }
}

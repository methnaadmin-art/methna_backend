import {
    Controller,
    Get,
    Post,
    Query,
    Param,
    Body,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MatchingService } from './matching.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('matching')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('matching')
export class MatchingController {
    constructor(private readonly matchingService: MatchingService) { }

    @Get('smart-suggestions')
    @ApiOperation({ summary: 'Get behavior-learned smart suggestions' })
    async getSmartSuggestions(
        @CurrentUser('sub') userId: string,
        @Query('limit') limit?: number,
    ) {
        return this.matchingService.getSmartSuggestions(userId, limit || 20);
    }

    @Post('precompute-compatibility')
    @ApiOperation({ summary: 'Precompute and cache compatibility scores' })
    async precomputeCompatibility(@CurrentUser('sub') userId: string) {
        await this.matchingService.precomputeCompatibility(userId);
        return { message: 'Compatibility scores precomputed and cached' };
    }

    @Get('compatibility/:targetUserId')
    @ApiOperation({ summary: 'Get cached compatibility score with another user' })
    async getCompatibility(
        @CurrentUser('sub') userId: string,
        @Param('targetUserId') targetUserId: string,
    ) {
        const score = await this.matchingService.getCachedCompatibility(userId, targetUserId);
        return { userId, targetUserId, compatibilityScore: score };
    }

    @Get('recommended')
    @ApiOperation({ summary: 'Get "Recommended for You" — blended 60% compat + 40% collaborative filtering' })
    async getRecommendedForYou(
        @CurrentUser('sub') userId: string,
        @Query('limit') limit?: number,
    ) {
        return this.matchingService.getRecommendedForYou(userId, limit || 10);
    }

    @Get('collaborative')
    @ApiOperation({ summary: 'Get collaborative filtering recommendations (users like you also liked)' })
    async getCollaborativeRecommendations(
        @CurrentUser('sub') userId: string,
        @Query('limit') limit?: number,
    ) {
        return this.matchingService.getCollaborativeRecommendations(userId, limit || 10);
    }

    @Get('baraka/:targetUserId')
    @ApiOperation({ summary: 'Get Baraka Meter score with another user (prayer, intentions, lifestyle)' })
    async getBaraka(
        @CurrentUser('sub') userId: string,
        @Param('targetUserId') targetUserId: string,
    ) {
        return this.matchingService.getBaraka(userId, targetUserId);
    }

    @Post('baraka/bulk')
    @ApiOperation({ summary: 'Get Baraka Meter scores for multiple users at once' })
    async getBulkBaraka(
        @CurrentUser('sub') userId: string,
        @Body() body: { targetUserIds: string[] },
    ) {
        return this.matchingService.getBulkBaraka(userId, body.targetUserIds);
    }

    @Get('ice-breakers/:targetUserId')
    @ApiOperation({ summary: 'Get smart ice breaker suggestions based on shared interests' })
    async getIceBreakers(
        @CurrentUser('sub') userId: string,
        @Param('targetUserId') targetUserId: string,
    ) {
        return this.matchingService.getIceBreakers(userId, targetUserId);
    }
}

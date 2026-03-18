import {
    Controller,
    Get,
    Post,
    Query,
    Param,
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
}

import {
    Controller,
    Post,
    Get,
    Param,
    Body,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SwipesService } from './swipes.service';
import { CreateSwipeDto } from './dto/swipe.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('swipes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('swipes')
export class SwipesController {
    constructor(private readonly swipesService: SwipesService) { }

    @Post()
    @Throttle({ default: { ttl: 60000, limit: 30 } })
    @ApiOperation({ summary: 'Swipe on a user (like, super_like, compliment, pass)' })
    async swipe(
        @CurrentUser('sub') userId: string,
        @Body() dto: CreateSwipeDto,
    ) {
        return this.swipesService.swipe(userId, dto);
    }

    @Post('rewind')
    @Throttle({ default: { ttl: 60000, limit: 5 } })
    @ApiOperation({ summary: 'Undo last swipe (limited for free, unlimited for premium)' })
    async rewind(@CurrentUser('sub') userId: string) {
        return this.swipesService.rewind(userId);
    }

    @Get('interactions')
    @ApiOperation({ summary: 'Get all my sent interactions (liked + passed users)' })
    async getInteractions(
        @CurrentUser('sub') userId: string,
        @Query('limit') limit?: number,
    ) {
        return this.swipesService.getInteractions(userId, limit || 120);
    }

    @Get('likes-sent')
    @ApiOperation({ summary: 'Get users I have liked' })
    async getLikesSent(@CurrentUser('sub') userId: string) {
        return this.swipesService.getLikesSent(userId);
    }

    @Get('who-liked-me')
    @ApiOperation({ summary: 'See who liked you (premium: full profiles, free: blurred teaser + count)' })
    async getWhoLikedMe(@CurrentUser('sub') userId: string) {
        return this.swipesService.getWhoLikedMe(userId);
    }

    @Get('compatibility/:targetUserId')
    @ApiOperation({ summary: 'Get compatibility score with another user' })
    async getCompatibility(
        @CurrentUser('sub') userId: string,
        @Param('targetUserId') targetUserId: string,
    ) {
        const score = await this.swipesService.getCompatibilityScore(userId, targetUserId);
        return { compatibilityScore: score };
    }

    // ─── REMATCH / SECOND CHANCE ────────────────────────────

    @Post('rematch/:targetUserId')
    @ApiOperation({ summary: 'Request a rematch / second chance (premium)' })
    async requestRematch(
        @CurrentUser('sub') userId: string,
        @Param('targetUserId') targetUserId: string,
        @Body('message') message?: string,
    ) {
        return this.swipesService.requestRematch(userId, targetUserId, message);
    }

    @Post('rematch/:requestId/accept')
    @ApiOperation({ summary: 'Accept a rematch request' })
    async acceptRematch(
        @CurrentUser('sub') userId: string,
        @Param('requestId') requestId: string,
    ) {
        return this.swipesService.acceptRematch(userId, requestId);
    }

    @Post('rematch/:requestId/reject')
    @ApiOperation({ summary: 'Reject a rematch request' })
    async rejectRematch(
        @CurrentUser('sub') userId: string,
        @Param('requestId') requestId: string,
    ) {
        return this.swipesService.rejectRematch(userId, requestId);
    }

    @Get('rematch/requests')
    @ApiOperation({ summary: 'Get my pending rematch requests' })
    async getMyRematchRequests(@CurrentUser('sub') userId: string) {
        return this.swipesService.getMyRematchRequests(userId);
    }
}

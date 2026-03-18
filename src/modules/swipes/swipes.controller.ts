import {
    Controller,
    Post,
    Get,
    Param,
    Body,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
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
    @ApiOperation({ summary: 'Swipe on a user (like, super_like, compliment, pass)' })
    async swipe(
        @CurrentUser('sub') userId: string,
        @Body() dto: CreateSwipeDto,
    ) {
        return this.swipesService.swipe(userId, dto);
    }

    @Get('who-liked-me')
    @ApiOperation({ summary: 'See who liked you (premium: full list, free: count only)' })
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
}

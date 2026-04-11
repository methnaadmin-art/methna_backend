import {
    Controller,
    Get,
    Delete,
    Param,
    Query,
    UseGuards,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MatchesService } from './matches.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiTags('matches')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('matches')
export class MatchesController {
    constructor(private readonly matchesService: MatchesService) { }

    @Get()
    @ApiOperation({ summary: 'Get all matches' })
    async getMatches(
        @CurrentUser('sub') userId: string,
        @Query() pagination: PaginationDto,
    ) {
        return this.matchesService.getMatches(userId, pagination);
    }

    @Get('suggestions')
    @ApiOperation({ summary: 'Get profile suggestions for swiping' })
    async getSuggestions(
        @CurrentUser('sub') userId: string,
        @Query('limit') limit?: number,
    ) {
        return this.matchesService.getSuggestions(userId, limit || 20);
    }

    @Get('nearby')
    @ApiOperation({ summary: 'Get nearby users (radar)' })
    async getNearbyUsers(
        @CurrentUser('sub') userId: string,
        @Query('radius') radius?: number,
        @Query('limit') limit?: number,
        @Query('country') country?: string,
        @Query('city') city?: string,
    ) {
        return this.matchesService.getNearbyUsers(userId, radius || 50, limit || 30, country, city);
    }

    @Get('discover')
    @ApiOperation({ summary: 'Get discovery categories (nearby, compatible, new)' })
    async getDiscoveryCategories(@CurrentUser('sub') userId: string) {
        return this.matchesService.getDiscoveryCategories(userId);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Unmatch a user' })
    async unmatch(
        @CurrentUser('sub') userId: string,
        @Param('id') matchId: string,
    ) {
        return this.matchesService.unmatch(userId, matchId);
    }
}

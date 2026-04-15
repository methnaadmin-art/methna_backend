import { Controller, Get, Query, UseGuards, Logger, InternalServerErrorException, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SearchService } from './search.service';
import { SearchFiltersDto } from './dto/search.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ModerationGuard } from '../../common/guards/moderation.guard';

@ApiTags('search')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ModerationGuard)
@Controller('search')
export class SearchController {
    private readonly logger = new Logger(SearchController.name);

    constructor(private readonly searchService: SearchService) { }

    @Get()
    @Throttle({ default: { ttl: 60000, limit: 20 } })
    @ApiOperation({ summary: 'Search profiles with filters' })
    async search(
        @CurrentUser('sub') userId: string,
        @Query() filters: SearchFiltersDto,
    ) {
        try {
            this.logger.log(`[Search] userId=${userId}, filters=${JSON.stringify(filters)}`);
            const result = await this.searchService.search(userId, filters);
            this.logger.log(`[Search] returned ${result?.users?.length ?? 0} users for userId=${userId}`);
            return result;
        } catch (error) {
            this.logger.error(`[Search] FAILED for userId=${userId}: ${error.message}`, error.stack);
            // Re-throw HttpExceptions as-is (e.g., validation errors)
            if (error instanceof HttpException) {
                throw error;
            }
            // In development, surface the real error message
            const isDev = process.env.NODE_ENV !== 'production';
            throw new InternalServerErrorException(
                isDev ? `Search failed: ${error.message}` : 'Search failed. Please try again.',
            );
        }
    }
}

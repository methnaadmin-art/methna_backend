import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SearchService } from './search.service';
import { SearchFiltersDto } from './dto/search.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('search')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('search')
export class SearchController {
    constructor(private readonly searchService: SearchService) { }

    @Get()
    @Throttle({ default: { ttl: 60000, limit: 20 } })
    @ApiOperation({ summary: 'Search profiles with filters' })
    async search(
        @CurrentUser('sub') userId: string,
        @Query() filters: SearchFiltersDto,
    ) {
        return this.searchService.search(userId, filters);
    }
}

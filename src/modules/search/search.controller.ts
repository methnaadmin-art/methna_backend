import { Controller, Get, Query, UseGuards, Logger, InternalServerErrorException, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SearchService } from './search.service';
import { SearchFiltersDto } from './dto/search.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ModerationGuard } from '../../common/guards/moderation.guard';
import { PlansService } from '../plans/plans.service';

@ApiTags('search')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ModerationGuard)
@Controller('search')
export class SearchController {
    private readonly logger = new Logger(SearchController.name);

    constructor(
        private readonly searchService: SearchService,
        private readonly plansService: PlansService,
    ) { }

    @Get()
    @Throttle({ default: { ttl: 60000, limit: 20 } })
    @ApiOperation({ summary: 'Search profiles with filters' })
    async search(
        @CurrentUser('sub') userId: string,
        @Query() filters: SearchFiltersDto,
    ) {
        try {
            const effectiveFilters = await this.sanitizePremiumOnlyFilters(
                userId,
                filters,
            );
            return await this.searchService.search(userId, effectiveFilters);
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

    private async sanitizePremiumOnlyFilters(
        userId: string,
        filters: SearchFiltersDto,
    ): Promise<SearchFiltersDto> {
        let hasAdvancedFiltersAccess = false;

        try {
            hasAdvancedFiltersAccess = await this.plansService.hasFeature(
                userId,
                'advancedFilters',
            );
        } catch (error) {
            this.logger.warn(
                `[Search] Failed entitlement lookup for userId=${userId}; falling back to free-tier filters only: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }

        if (hasAdvancedFiltersAccess || !this.hasPremiumOnlyFilters(filters)) {
            return filters;
        }

        this.logger.debug(
            `[Search] Stripping premium-only filters for free-tier userId=${userId}`,
        );

        return {
            ...filters,
            education: undefined,
            religiousLevel: undefined,
            prayerFrequency: undefined,
            marriageIntention: undefined,
            timeFrame: undefined,
            intentMode: undefined,
            livingSituation: undefined,
            interests: undefined,
            languages: undefined,
            familyValues: undefined,
            communicationStyles: undefined,
            verifiedOnly: undefined,
            recentlyActiveOnly: undefined,
            withPhotosOnly: undefined,
            minTrustScore: undefined,
            backgroundCheckStatus: undefined,
        };
    }

    private hasPremiumOnlyFilters(filters: SearchFiltersDto): boolean {
        return Boolean(
            filters.education ||
                filters.religiousLevel ||
                filters.prayerFrequency ||
                filters.marriageIntention ||
                filters.timeFrame ||
                filters.intentMode ||
                filters.livingSituation ||
                (filters.interests?.length ?? 0) > 0 ||
                (filters.languages?.length ?? 0) > 0 ||
                (filters.familyValues?.length ?? 0) > 0 ||
                (filters.communicationStyles?.length ?? 0) > 0 ||
                filters.verifiedOnly ||
                filters.recentlyActiveOnly ||
                filters.withPhotosOnly ||
                (filters.minTrustScore ?? 0) > 0 ||
                filters.backgroundCheckStatus,
        );
    }
}

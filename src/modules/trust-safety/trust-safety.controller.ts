import {
    Controller,
    Get,
    Post,
    Patch,
    Param,
    Query,
    Body,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TrustSafetyService } from './trust-safety.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../database/entities/user.entity';
import { ContentFlagStatus } from '../../database/entities/content-flag.entity';

@ApiTags('trust-safety')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('trust-safety')
export class TrustSafetyController {
    constructor(private readonly trustSafetyService: TrustSafetyService) { }

    @Post('selfie-verify')
    @ApiOperation({ summary: 'Compare selfie to profile photos (mock AI)' })
    async verifySelfie(@CurrentUser('sub') userId: string) {
        return this.trustSafetyService.compareSelfieToPhotos(userId);
    }

    @Get('trust-score')
    @ApiOperation({ summary: 'Get your trust score' })
    async getTrustScore(@CurrentUser('sub') userId: string) {
        const score = await this.trustSafetyService.getTrustScore(userId);
        return { trustScore: score };
    }

    // ─── ADMIN ENDPOINTS ────────────────────────────────────

    @Get('admin/flags')
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Get pending content flags (admin)' })
    async getPendingFlags(
        @Query('page') page?: number,
        @Query('limit') limit?: number,
    ) {
        return this.trustSafetyService.getPendingFlags(page || 1, limit || 20);
    }

    @Patch('admin/flags/:id')
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Resolve a content flag (admin)' })
    async resolveFlag(
        @CurrentUser('sub') adminId: string,
        @Param('id') flagId: string,
        @Body() body: { status: ContentFlagStatus; note?: string },
    ) {
        await this.trustSafetyService.resolveFlag(flagId, adminId, body.status, body.note);
        return { message: 'Flag resolved' };
    }

    @Post('admin/shadow-ban/:userId')
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Shadow ban a user (admin)' })
    async shadowBan(@Param('userId') userId: string) {
        await this.trustSafetyService.shadowBanUser(userId);
        return { message: 'User shadow banned' };
    }

    @Post('admin/remove-shadow-ban/:userId')
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Remove shadow ban (admin)' })
    async removeShadowBan(@Param('userId') userId: string) {
        await this.trustSafetyService.removeShadowBan(userId);
        return { message: 'Shadow ban removed' };
    }

    @Post('admin/detect-suspicious/:userId')
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Run suspicious behavior detection on a user (admin)' })
    async detectSuspicious(@Param('userId') userId: string) {
        return this.trustSafetyService.detectSuspiciousBehavior(userId);
    }
}

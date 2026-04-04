import {
    Controller,
    Get,
    Post,
    Patch,
    Param,
    Query,
    Body,
    UseGuards,
    UseInterceptors,
    UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { TrustSafetyService } from './trust-safety.service';
import { BackgroundCheckService } from './background-check.service';
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
    constructor(
        private readonly trustSafetyService: TrustSafetyService,
        private readonly backgroundCheckService: BackgroundCheckService,
    ) { }

    // ─── Selfie Upload + Verify ──────────────────────────────

    @Post('selfie-upload')
    @UseInterceptors(FileInterceptor('selfie'))
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                selfie: { type: 'string', format: 'binary' },
            },
        },
    })
    @ApiOperation({ summary: 'Upload a selfie for verification' })
    async uploadSelfie(
        @CurrentUser('sub') userId: string,
        @UploadedFile() file: Express.Multer.File,
    ) {
        return this.trustSafetyService.uploadSelfie(userId, file);
    }

    @Post('selfie-verify')
    @ApiOperation({ summary: 'Submit selfie verification for automated or manual review' })
    async verifySelfie(@CurrentUser('sub') userId: string) {
        return this.trustSafetyService.compareSelfieToPhotos(userId);
    }

    // ─── ID Document Upload ──────────────────────────────────

    @Post('id-upload')
    @UseInterceptors(FileInterceptor('document'))
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                document: { type: 'string', format: 'binary' },
            },
        },
    })
    @ApiOperation({ summary: 'Upload an ID document for identity verification' })
    async uploadIdDocument(
        @CurrentUser('sub') userId: string,
        @UploadedFile() file: Express.Multer.File,
    ) {
        return this.trustSafetyService.uploadIdDocument(userId, file);
    }

    // ─── Marriage Certificate Upload ─────────────────────────

    @Post('marriage-cert-upload')
    @UseInterceptors(FileInterceptor('certificate'))
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                certificate: { type: 'string', format: 'binary' },
            },
        },
    })
    @ApiOperation({ summary: 'Upload a marriage certificate for verification' })
    async uploadMarriageCert(
        @CurrentUser('sub') userId: string,
        @UploadedFile() file: Express.Multer.File,
    ) {
        return this.trustSafetyService.uploadMarriageCert(userId, file);
    }

    // ─── Verification Status ─────────────────────────────────

    @Get('verification-status')
    @ApiOperation({ summary: 'Get current verification status of user' })
    async getVerificationStatus(@CurrentUser('sub') userId: string) {
        return this.trustSafetyService.getVerificationStatus(userId);
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

    // ─── BACKGROUND CHECK ────────────────────────────────────

    @Post('background-check')
    @ApiOperation({ summary: 'Initiate a background check (requires consent)' })
    async initiateBackgroundCheck(
        @CurrentUser('sub') userId: string,
        @Body() body: { fullName: string; dateOfBirth: string; consentGiven: boolean },
    ) {
        return this.backgroundCheckService.initiateCheck(userId, body);
    }

    @Get('background-check')
    @ApiOperation({ summary: 'Get background check status' })
    async getBackgroundCheckStatus(@CurrentUser('sub') userId: string) {
        return this.backgroundCheckService.getCheckStatus(userId);
    }

    @Post('background-check/webhook')
    @ApiOperation({ summary: 'Handle background check provider webhook' })
    async backgroundCheckWebhook(@Body() payload: any) {
        await this.backgroundCheckService.handleWebhook(payload);
        return { received: true };
    }
}

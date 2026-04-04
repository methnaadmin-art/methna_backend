import {
    Controller,
    Get,
    Post,
    Put,
    Patch,
    Param,
    Body,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ProfilesService } from './profiles.service';
import {
    CreateProfileDto,
    UpdateProfileDto,
    UpdatePreferencesDto,
    UpdatePrivacySettingsDto,
    UpdateLocationDto,
} from './dto/profile.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('profiles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('profiles')
export class ProfilesController {
    constructor(private readonly profilesService: ProfilesService) { }

    @Get('me')
    @ApiOperation({ summary: 'Get my profile' })
    async getMyProfile(@CurrentUser('sub') userId: string) {
        return this.profilesService.getProfile(userId);
    }

    @Post()
    @ApiOperation({ summary: 'Create or update profile' })
    async createOrUpdateProfile(
        @CurrentUser('sub') userId: string,
        @Body() dto: UpdateProfileDto,
    ) {
        return this.profilesService.createOrUpdateProfile(userId, dto);
    }

    // ─── Location ───────────────────────────────────────────

    @Patch('location')
    @ApiOperation({ summary: 'Update my location (lat/lng)' })
    async updateLocation(
        @CurrentUser('sub') userId: string,
        @Body() dto: UpdateLocationDto,
    ) {
        return this.profilesService.updateLocation(userId, dto);
    }

    // ─── Privacy ────────────────────────────────────────────

    @Patch('privacy')
    @ApiOperation({ summary: 'Update privacy settings' })
    async updatePrivacy(
        @CurrentUser('sub') userId: string,
        @Body() dto: UpdatePrivacySettingsDto,
    ) {
        return this.profilesService.updatePrivacySettings(userId, dto);
    }

    // ─── Preferences ────────────────────────────────────────

    @Get('preferences')
    @ApiOperation({ summary: 'Get my preferences' })
    async getPreferences(@CurrentUser('sub') userId: string) {
        return this.profilesService.getPreferences(userId);
    }

    @Put('preferences')
    @ApiOperation({ summary: 'Update preferences' })
    async updatePreferences(
        @CurrentUser('sub') userId: string,
        @Body() dto: UpdatePreferencesDto,
    ) {
        return this.profilesService.updatePreferences(userId, dto);
    }

    @Get(':userId')
    @ApiOperation({ summary: 'Get profile by user ID' })
    async getProfileByUserId(@Param('userId') userId: string) {
        return this.profilesService.getProfile(userId);
    }
}


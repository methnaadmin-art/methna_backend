import {
    Controller,
    Get,
    Post,
    Body,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MonetizationService } from './monetization.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('monetization')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('monetization')
export class MonetizationController {
    constructor(private readonly monetizationService: MonetizationService) { }

    @Get('status')
    @ApiOperation({ summary: 'Get subscription status, features, limits, and boost info' })
    async getStatus(@CurrentUser('sub') userId: string) {
        return this.monetizationService.getUserSubscriptionStatus(userId);
    }

    @Get('plans')
    @ApiOperation({ summary: 'Get all active subscription plans' })
    async getActivePlans() {
        return this.monetizationService.getActivePlans();
    }

    @Get('features')
    @ApiOperation({ summary: 'Get available features for current plan' })
    async getFeatures(@CurrentUser('sub') userId: string) {
        const features = await this.monetizationService.getUserFeatures(userId);
        return { features };
    }

    @Get('remaining-likes')
    @ApiOperation({ summary: 'Get remaining daily likes' })
    async getRemainingLikes(@CurrentUser('sub') userId: string) {
        return this.monetizationService.getRemainingLikes(userId);
    }

    @Post('subscribe')
    @ApiOperation({ summary: 'Purchase a subscription plan' })
    async subscribe(
        @CurrentUser('sub') userId: string,
        @Body() body: { plan: string; durationDays: number; paymentReference: string },
    ) {
        return this.monetizationService.purchaseSubscription(
            userId,
            body.plan,
            body.durationDays,
            body.paymentReference,
        );
    }

    @Post('boost')
    @ApiOperation({ summary: 'Purchase a profile boost' })
    async purchaseBoost(
        @CurrentUser('sub') userId: string,
        @Body() body: { durationMinutes?: number },
    ) {
        return this.monetizationService.purchaseBoost(userId, body.durationMinutes || 30);
    }

    @Get('boost')
    @ApiOperation({ summary: 'Get active boost status' })
    async getBoostStatus(@CurrentUser('sub') userId: string) {
        const isBoosted = await this.monetizationService.isUserBoosted(userId);
        const boost = isBoosted ? await this.monetizationService.getActiveBoost(userId) : null;
        return { isActive: isBoosted, boost };
    }

    // ─── Rewind ───────────────────────────────────────────────

    @Get('rewind')
    @ApiOperation({ summary: 'Check if user can rewind (undo last swipe)' })
    async canRewind(@CurrentUser('sub') userId: string) {
        const canRewind = await this.monetizationService.canRewind(userId);
        return { canRewind };
    }

    @Post('rewind')
    @ApiOperation({ summary: 'Use a rewind (undo last swipe)' })
    async useRewind(@CurrentUser('sub') userId: string) {
        return this.monetizationService.useRewind(userId);
    }

    // ─── Compliment Credits ───────────────────────────────────

    @Get('compliments')
    @ApiOperation({ summary: 'Get remaining compliment credits for today' })
    async getRemainingCompliments(@CurrentUser('sub') userId: string) {
        return this.monetizationService.getRemainingCompliments(userId);
    }

    // ─── Invisible Mode ───────────────────────────────────────

    @Post('invisible')
    @ApiOperation({ summary: 'Toggle invisible mode (Premium only)' })
    async toggleInvisible(
        @CurrentUser('sub') userId: string,
        @Body() body: { enabled: boolean },
    ) {
        await this.monetizationService.toggleInvisibleMode(userId, body.enabled);
        return { message: body.enabled ? 'Invisible mode enabled' : 'Invisible mode disabled' };
    }

    @Get('invisible')
    @ApiOperation({ summary: 'Check if invisible mode is active' })
    async isInvisible(@CurrentUser('sub') userId: string) {
        const invisible = await this.monetizationService.isInvisible(userId);
        return { isInvisible: invisible };
    }

    // ─── Passport Mode ────────────────────────────────────────

    @Post('passport')
    @ApiOperation({ summary: 'Set virtual location for passport mode' })
    async setPassportLocation(
        @CurrentUser('sub') userId: string,
        @Body() body: { latitude: number; longitude: number; city?: string; country?: string },
    ) {
        await this.monetizationService.setPassportLocation(
            userId, body.latitude, body.longitude, body.city, body.country,
        );
        return { message: 'Passport location set', location: body };
    }

    @Post('passport/clear')
    @ApiOperation({ summary: 'Clear passport mode and use real location' })
    async clearPassportLocation(@CurrentUser('sub') userId: string) {
        await this.monetizationService.clearPassportLocation(userId);
        return { message: 'Passport location cleared' };
    }

    @Get('passport')
    @ApiOperation({ summary: 'Get current passport location if set' })
    async getPassportLocation(@CurrentUser('sub') userId: string) {
        const location = await this.monetizationService.getPassportLocation(userId);
        return { active: !!location, location };
    }

    // ─── Monthly Limits ───────────────────────────────────────

    @Get('limits')
    @ApiOperation({ summary: 'Get all daily and monthly limits for current plan' })
    async getLimits(@CurrentUser('sub') userId: string) {
        const daily = await this.monetizationService.getDailyLimits(userId);
        const monthly = await this.monetizationService.getMonthlyLimits(userId);
        const remainingLikes = await this.monetizationService.getRemainingLikes(userId);
        const remainingCompliments = await this.monetizationService.getRemainingCompliments(userId);
        const canRewind = await this.monetizationService.canRewind(userId);
        return { daily, monthly, remainingLikes, remainingCompliments, canRewind };
    }
}

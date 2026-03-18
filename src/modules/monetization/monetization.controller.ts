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
import { SubscriptionPlan } from '../../database/entities/subscription.entity';

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
        @Body() body: { plan: SubscriptionPlan; durationDays: number; paymentReference: string },
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
}

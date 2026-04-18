import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    UseGuards,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PlansService } from './plans.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities/user.entity';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IsString, IsNumber, IsBoolean, IsOptional, IsEnum, ValidateNested, IsInt, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    Plan,
    PlanEntitlements,
    PlanFeatureFlags,
    PlanLimits,
    BillingCycle,
} from '../../database/entities/plan.entity';

class EntitlementsDto implements PlanEntitlements {
    @ApiPropertyOptional() @IsOptional() @IsInt() dailyLikes?: number;
    @ApiPropertyOptional() @IsOptional() @IsInt() dailySuperLikes?: number;
    @ApiPropertyOptional() @IsOptional() @IsInt() dailyCompliments?: number;
    @ApiPropertyOptional() @IsOptional() @IsInt() monthlyRewinds?: number;
    @ApiPropertyOptional() @IsOptional() @IsInt() weeklyBoosts?: number;
    @ApiPropertyOptional() @IsOptional() @IsInt() likesLimit?: number;
    @ApiPropertyOptional() @IsOptional() @IsInt() boostsLimit?: number;
    @ApiPropertyOptional() @IsOptional() @IsInt() complimentsLimit?: number;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() unlimitedLikes?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() unlimitedRewinds?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() advancedFilters?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() seeWhoLikesYou?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() whoLikedMe?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() readReceipts?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() typingIndicators?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() invisibleMode?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() ghostMode?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() passportMode?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() boost?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() likes?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() premiumBadge?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() hideAds?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() rematch?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() videoChat?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() superLike?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() profileBoostPriority?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() priorityMatching?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() improvedVisits?: boolean;
}

class FeatureFlagsDto implements PlanFeatureFlags {
    @ApiPropertyOptional() @IsOptional() @IsBoolean() unlimitedLikes?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() unlimitedRewinds?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() advancedFilters?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() seeWhoLikesYou?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() whoLikedMe?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() readReceipts?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() typingIndicators?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() invisibleMode?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() ghostMode?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() passportMode?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() boost?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() likes?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() premiumBadge?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() hideAds?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() rematch?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() videoChat?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() superLike?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() profileBoostPriority?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() priorityMatching?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() improvedVisits?: boolean;
}

class LimitsDto implements PlanLimits {
    @ApiPropertyOptional() @IsOptional() @IsInt() dailyLikes?: number;
    @ApiPropertyOptional() @IsOptional() @IsInt() dailySuperLikes?: number;
    @ApiPropertyOptional() @IsOptional() @IsInt() dailyCompliments?: number;
    @ApiPropertyOptional() @IsOptional() @IsInt() monthlyRewinds?: number;
    @ApiPropertyOptional() @IsOptional() @IsInt() weeklyBoosts?: number;
    @ApiPropertyOptional() @IsOptional() @IsInt() likesLimit?: number;
    @ApiPropertyOptional() @IsOptional() @IsInt() boostsLimit?: number;
    @ApiPropertyOptional() @IsOptional() @IsInt() complimentsLimit?: number;
}

class CreatePlanDto {
    @ApiProperty() @IsString() code: string;
    @ApiProperty() @IsString() name: string;
    @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
    @ApiProperty() @IsNumber() price: number;
    @ApiPropertyOptional() @IsOptional() @IsString() currency?: string;
    @ApiPropertyOptional() @IsOptional() @IsEnum(BillingCycle) billingCycle?: BillingCycle;
    @ApiPropertyOptional() @IsOptional() @IsString() googleProductId?: string;
    @ApiPropertyOptional() @IsOptional() @IsString() googleBasePlanId?: string;
    @ApiPropertyOptional() @IsOptional() @IsString() stripePriceId?: string;
    @ApiPropertyOptional() @IsOptional() @IsString() stripeProductId?: string;
    @ApiPropertyOptional() @IsOptional() @IsInt() durationDays?: number;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() isVisible?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
    @ApiPropertyOptional() @IsOptional() @ValidateNested() @Type(() => EntitlementsDto) entitlements?: EntitlementsDto;
    @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() featureFlags?: FeatureFlagsDto;
    @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() limits?: LimitsDto;
}

class UpdatePlanDto {
    @ApiPropertyOptional() @IsOptional() @IsString() code?: string;
    @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
    @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
    @ApiPropertyOptional() @IsOptional() @IsNumber() price?: number;
    @ApiPropertyOptional() @IsOptional() @IsString() currency?: string;
    @ApiPropertyOptional() @IsOptional() @IsEnum(BillingCycle) billingCycle?: BillingCycle;
    @ApiPropertyOptional() @IsOptional() @IsString() googleProductId?: string;
    @ApiPropertyOptional() @IsOptional() @IsString() googleBasePlanId?: string;
    @ApiPropertyOptional() @IsOptional() @IsString() stripePriceId?: string;
    @ApiPropertyOptional() @IsOptional() @IsString() stripeProductId?: string;
    @ApiPropertyOptional() @IsOptional() @IsInt() durationDays?: number;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() isVisible?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
    @ApiPropertyOptional() @IsOptional() @ValidateNested() @Type(() => EntitlementsDto) entitlements?: EntitlementsDto;
    @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() featureFlags?: FeatureFlagsDto;
    @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() limits?: LimitsDto;
}

@ApiTags('plans')
@Controller('plans')
export class PlansController {
    constructor(private readonly plansService: PlansService) { }

    // ─── PUBLIC ─────────────────────────────────────────────

    @Get('public')
    @ApiOperation({ summary: 'Get active visible plans for mobile app' })
    async getPublicPlans() {
        const plans = await this.plansService.getPublicPlans();
        return plans;
    }

    // ─── AUTHENTICATED ──────────────────────────────────────
    // NOTE: Static routes MUST be declared BEFORE @Get(':id') to avoid
    // NestJS matching the dynamic param first (e.g. 'entitlements' as :id).

    @Get('entitlements/me')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get current user entitlements' })
    async getMyEntitlements(@CurrentUser('sub') userId: string) {
        const resolved = await this.plansService.resolveUserEntitlements(userId);
        const plan = resolved.plan;
        const entitlements = resolved.entitlements;

        const planFeatures = this.buildPlanFeatureMatrix(plan.featureFlags, entitlements);
        const limits = this.buildPlanLimits(plan, entitlements);
        const features = this.buildFeatureList(plan.features, planFeatures, limits);

        return {
            ...resolved,
            features,
            planFeatures,
            limits,
        };
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get a single plan by ID' })
    async getPlanById(@Param('id') id: string) {
        return this.plansService.getPlanById(id);
    }

    // ─── ADMIN ──────────────────────────────────────────────

    @Get()
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'List all plans (admin)' })
    async getAllPlans() {
        return this.plansService.getAllPlans();
    }

    @Post()
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Create a new plan (admin)' })
    async createPlan(@Body() dto: CreatePlanDto) {
        return this.plansService.createPlan(dto);
    }

    @Put(':id')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Update a plan (admin)' })
    async updatePlan(@Param('id') id: string, @Body() dto: UpdatePlanDto) {
        return this.plansService.updatePlan(id, dto);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Delete/deactivate a plan (admin)' })
    async deletePlan(@Param('id') id: string) {
        return this.plansService.deletePlan(id);
    }

    private buildPlanFeatureMatrix(
        featureFlags: PlanFeatureFlags | null | undefined,
        entitlements: PlanEntitlements,
    ): PlanFeatureFlags {
        return {
            ...(featureFlags || {}),
            unlimitedLikes: featureFlags?.unlimitedLikes ?? entitlements.unlimitedLikes,
            unlimitedRewinds: featureFlags?.unlimitedRewinds ?? entitlements.unlimitedRewinds,
            advancedFilters: featureFlags?.advancedFilters ?? entitlements.advancedFilters,
            seeWhoLikesYou: featureFlags?.seeWhoLikesYou ?? entitlements.seeWhoLikesYou,
            whoLikedMe: featureFlags?.whoLikedMe ?? entitlements.whoLikedMe,
            readReceipts: featureFlags?.readReceipts ?? entitlements.readReceipts,
            typingIndicators: featureFlags?.typingIndicators ?? entitlements.typingIndicators,
            invisibleMode: featureFlags?.invisibleMode ?? entitlements.invisibleMode,
            ghostMode: featureFlags?.ghostMode ?? entitlements.ghostMode,
            passportMode: featureFlags?.passportMode ?? entitlements.passportMode,
            boost: featureFlags?.boost ?? entitlements.boost,
            likes: featureFlags?.likes ?? entitlements.likes,
            premiumBadge: featureFlags?.premiumBadge ?? entitlements.premiumBadge,
            hideAds: featureFlags?.hideAds ?? entitlements.hideAds,
            rematch: featureFlags?.rematch ?? entitlements.rematch,
            videoChat: featureFlags?.videoChat ?? entitlements.videoChat,
            superLike: featureFlags?.superLike ?? entitlements.superLike,
            profileBoostPriority:
                featureFlags?.profileBoostPriority ?? entitlements.profileBoostPriority,
            priorityMatching: featureFlags?.priorityMatching ?? entitlements.priorityMatching,
            improvedVisits: featureFlags?.improvedVisits ?? entitlements.improvedVisits,
        };
    }

    private buildPlanLimits(plan: Plan, entitlements: PlanEntitlements): PlanLimits {
        const limits = (plan.limits || {}) as PlanLimits;

        return {
            ...limits,
            dailyLikes: entitlements.dailyLikes ?? limits.dailyLikes ?? plan.dailyLikesLimit,
            dailySuperLikes:
                entitlements.dailySuperLikes ??
                limits.dailySuperLikes ??
                plan.dailySuperLikesLimit,
            dailyCompliments:
                entitlements.dailyCompliments ??
                limits.dailyCompliments ??
                plan.dailyComplimentsLimit,
            monthlyRewinds:
                entitlements.monthlyRewinds ??
                limits.monthlyRewinds ??
                plan.monthlyRewindsLimit,
            weeklyBoosts:
                entitlements.weeklyBoosts ??
                limits.weeklyBoosts ??
                plan.weeklyBoostsLimit,
            likesLimit: entitlements.likesLimit ?? limits.likesLimit,
            boostsLimit: entitlements.boostsLimit ?? limits.boostsLimit,
            complimentsLimit: entitlements.complimentsLimit ?? limits.complimentsLimit,
        };
    }

    private buildFeatureList(
        planFeatures: string[] | null | undefined,
        featureMatrix: PlanFeatureFlags,
        limits: PlanLimits,
    ): string[] {
        const features = new Set<string>();

        for (const rawFeature of planFeatures || []) {
            const normalized = String(rawFeature || '').trim().toLowerCase();
            if (normalized) {
                features.add(normalized);
            }
        }

        const addFeature = (enabled: boolean | undefined, ...tokens: string[]) => {
            if (enabled !== true) {
                return;
            }
            for (const token of tokens) {
                features.add(token);
            }
        };

        addFeature(featureMatrix.unlimitedLikes, 'unlimited_likes');
        addFeature(featureMatrix.unlimitedRewinds, 'rewind');
        addFeature(featureMatrix.advancedFilters, 'advanced_filters');
        addFeature(featureMatrix.seeWhoLikesYou, 'see_who_liked', 'who_liked_me');
        addFeature(featureMatrix.whoLikedMe, 'who_liked_me', 'see_who_liked');
        addFeature(featureMatrix.readReceipts, 'read_receipts');
        addFeature(featureMatrix.typingIndicators, 'typing_indicators');
        addFeature(featureMatrix.invisibleMode, 'invisible_mode', 'ghost_mode');
        addFeature(featureMatrix.ghostMode, 'ghost_mode', 'invisible_mode');
        addFeature(featureMatrix.passportMode, 'passport_mode');
        addFeature(featureMatrix.boost, 'boost', 'profile_boost');
        addFeature(featureMatrix.likes, 'likes');
        addFeature(featureMatrix.premiumBadge, 'premium_badge');
        addFeature(featureMatrix.hideAds, 'hide_ads');
        addFeature(featureMatrix.rematch, 'rematch');
        addFeature(featureMatrix.videoChat, 'video_chat');
        addFeature(featureMatrix.superLike, 'super_like');
        addFeature(featureMatrix.profileBoostPriority, 'profile_boost');
        addFeature(featureMatrix.priorityMatching, 'priority_matching');
        addFeature(featureMatrix.improvedVisits, 'improved_visits');

        if (this.isPositiveOrUnlimited(limits.weeklyBoosts) || this.isPositiveOrUnlimited(limits.boostsLimit)) {
            features.add('profile_boost');
        }
        if (this.isPositiveOrUnlimited(limits.dailyCompliments) || this.isPositiveOrUnlimited(limits.complimentsLimit)) {
            features.add('compliment_credits');
        }
        if (this.isPositiveOrUnlimited(limits.dailySuperLikes)) {
            features.add('super_like');
        }

        return Array.from(features);
    }

    private isPositiveOrUnlimited(value: number | undefined): boolean {
        return typeof value === 'number' && (value === -1 || value > 0);
    }
}

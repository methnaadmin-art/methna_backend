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
import { IsString, IsNumber, IsBoolean, IsOptional, IsEnum, ValidateNested, IsInt } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PlanEntitlements, BillingCycle } from '../../database/entities/plan.entity';

class EntitlementsDto implements PlanEntitlements {
    @ApiPropertyOptional() @IsOptional() @IsInt() dailyLikes?: number;
    @ApiPropertyOptional() @IsOptional() @IsInt() dailySuperLikes?: number;
    @ApiPropertyOptional() @IsOptional() @IsInt() dailyCompliments?: number;
    @ApiPropertyOptional() @IsOptional() @IsInt() monthlyRewinds?: number;
    @ApiPropertyOptional() @IsOptional() @IsInt() weeklyBoosts?: number;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() unlimitedLikes?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() unlimitedRewinds?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() advancedFilters?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() seeWhoLikesYou?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() readReceipts?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() typingIndicators?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() invisibleMode?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() passportMode?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() premiumBadge?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() hideAds?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() rematch?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() videoChat?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() superLike?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() profileBoostPriority?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() priorityMatching?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() improvedVisits?: boolean;
}

class CreatePlanDto {
    @ApiProperty() @IsString() code: string;
    @ApiProperty() @IsString() name: string;
    @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
    @ApiProperty() @IsNumber() price: number;
    @ApiPropertyOptional() @IsOptional() @IsString() currency?: string;
    @ApiPropertyOptional() @IsOptional() @IsEnum(BillingCycle) billingCycle?: BillingCycle;
    @ApiPropertyOptional() @IsOptional() @IsString() stripePriceId?: string;
    @ApiPropertyOptional() @IsOptional() @IsString() googleProductId?: string;
    @ApiPropertyOptional() @IsOptional() @IsInt() durationDays?: number;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() isVisible?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
    @ApiPropertyOptional() @IsOptional() @ValidateNested() @Type(() => EntitlementsDto) entitlements?: EntitlementsDto;
}

class UpdatePlanDto {
    @ApiPropertyOptional() @IsOptional() @IsString() code?: string;
    @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
    @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
    @ApiPropertyOptional() @IsOptional() @IsNumber() price?: number;
    @ApiPropertyOptional() @IsOptional() @IsString() currency?: string;
    @ApiPropertyOptional() @IsOptional() @IsEnum(BillingCycle) billingCycle?: BillingCycle;
    @ApiPropertyOptional() @IsOptional() @IsString() stripePriceId?: string;
    @ApiPropertyOptional() @IsOptional() @IsString() googleProductId?: string;
    @ApiPropertyOptional() @IsOptional() @IsInt() durationDays?: number;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsBoolean() isVisible?: boolean;
    @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
    @ApiPropertyOptional() @IsOptional() @ValidateNested() @Type(() => EntitlementsDto) entitlements?: EntitlementsDto;
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
        return this.plansService.resolveUserEntitlements(userId);
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
}

import {
    Controller,
    Get,
    Post,
    Delete,
    Body,
    UseGuards,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IsInt, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class CreateSubscriptionDto {
    @ApiPropertyOptional({ description: 'Dynamic plan id from the plans table' })
    @IsOptional()
    @IsString()
    planId?: string;

    @ApiPropertyOptional({ description: 'Dynamic plan code from the plans table' })
    @IsOptional()
    @IsString()
    planCode?: string;

    @ApiPropertyOptional({ description: 'Backward-compatible alias for planCode' })
    @IsOptional()
    @IsString()
    plan?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsInt()
    durationDays?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    paymentReference?: string;
}

@ApiTags('subscriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('subscriptions')
export class SubscriptionsController {
    constructor(private readonly subscriptionsService: SubscriptionsService) { }

    @Get('me')
    @ApiOperation({ summary: 'Get current subscription' })
    async getMySubscription(@CurrentUser('sub') userId: string) {
        return this.subscriptionsService.getMySubscription(userId);
    }

    @Post()
    @ApiOperation({ summary: 'Create or upgrade subscription' })
    async createSubscription(
        @CurrentUser('sub') userId: string,
        @Body() dto: CreateSubscriptionDto,
    ) {
        return this.subscriptionsService.createSubscription(
            userId,
            dto.planId || dto.planCode || dto.plan || '',
            dto.durationDays,
            dto.paymentReference,
        );
    }

    @Delete()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Cancel subscription' })
    async cancelSubscription(@CurrentUser('sub') userId: string) {
        return this.subscriptionsService.cancelSubscription(userId);
    }

    @Get('plans')
    @ApiOperation({ summary: 'Get all plan features' })
    async getPlans() {
        return this.subscriptionsService.getPublicPlans();
    }
}

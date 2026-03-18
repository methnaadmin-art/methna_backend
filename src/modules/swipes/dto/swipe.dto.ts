import { IsString, IsEnum, IsUUID, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum SwipeAction {
    LIKE = 'like',
    SUPER_LIKE = 'super_like',
    COMPLIMENT = 'compliment',
    PASS = 'pass',
}

export class CreateSwipeDto {
    @ApiProperty({ description: 'Target user ID' })
    @IsUUID()
    targetUserId: string;

    @ApiProperty({ enum: SwipeAction })
    @IsEnum(SwipeAction)
    action: SwipeAction;

    @ApiPropertyOptional({ description: 'Compliment message (required for compliment action)', maxLength: 500 })
    @IsOptional()
    @IsString()
    @MaxLength(500)
    complimentMessage?: string;
}

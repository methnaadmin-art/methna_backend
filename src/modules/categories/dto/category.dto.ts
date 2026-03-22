import { IsString, IsOptional, IsEnum, IsArray, ValidateNested, IsInt, Min, MaxLength, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CategoryStatus, RuleCondition } from '../../../database/entities/category.entity';

export class RuleConditionDto {
    @ApiProperty({ example: 'religiousLevel' })
    @IsString()
    field: string;

    @ApiProperty({ example: '=', enum: ['=', '!=', '>', '<', '>=', '<=', 'includes', 'not_includes'] })
    @IsIn(['=', '!=', '>', '<', '>=', '<=', 'includes', 'not_includes'])
    operator: RuleCondition['operator'];

    @ApiProperty({ example: 'very_practicing' })
    value: string | number | boolean;
}

export class CreateCategoryDto {
    @ApiProperty({ example: 'Devout & Ready to Relocate' })
    @IsString()
    @MaxLength(100)
    name: string;

    @ApiPropertyOptional({ example: 'Users who pray 5 times and are willing to relocate' })
    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string;

    @ApiPropertyOptional({ example: 'mosque' })
    @IsOptional()
    @IsString()
    icon?: string;

    @ApiPropertyOptional({ enum: CategoryStatus, default: CategoryStatus.ACTIVE })
    @IsOptional()
    @IsEnum(CategoryStatus)
    status?: CategoryStatus;

    @ApiPropertyOptional({ example: 0 })
    @IsOptional()
    @IsInt()
    @Min(0)
    sortOrder?: number;

    @ApiPropertyOptional({ type: [RuleConditionDto] })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => RuleConditionDto)
    rules?: RuleConditionDto[];

    @ApiPropertyOptional({ example: '#2d7a4f' })
    @IsOptional()
    @IsString()
    @MaxLength(20)
    color?: string;
}

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}

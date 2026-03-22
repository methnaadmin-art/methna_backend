import {
    IsOptional,
    IsEnum,
    IsInt,
    IsString,
    IsBoolean,
    IsNumber,
    Min,
    Max,
    IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Gender, MaritalStatus, ReligiousLevel, EducationLevel } from '../../../database/entities/profile.entity';

export class SearchFiltersDto {
    @ApiPropertyOptional({ minimum: 18 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(18)
    minAge?: number;

    @ApiPropertyOptional({ maximum: 100 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Max(100)
    maxAge?: number;

    @ApiPropertyOptional({ enum: Gender })
    @IsOptional()
    @IsEnum(Gender)
    gender?: Gender;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    city?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    country?: string;

    @ApiPropertyOptional({ enum: MaritalStatus })
    @IsOptional()
    @IsEnum(MaritalStatus)
    maritalStatus?: MaritalStatus;

    @ApiPropertyOptional({ enum: ReligiousLevel })
    @IsOptional()
    @IsEnum(ReligiousLevel)
    religiousLevel?: ReligiousLevel;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    ethnicity?: string;

    @ApiPropertyOptional({ enum: EducationLevel })
    @IsOptional()
    @IsEnum(EducationLevel)
    education?: EducationLevel;

    @ApiPropertyOptional({ type: [String], description: 'Filter by interests' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    interests?: string[];

    @ApiPropertyOptional({ description: 'Only show verified users' })
    @IsOptional()
    @IsBoolean()
    verifiedOnly?: boolean;

    @ApiPropertyOptional({ description: 'Max distance in km (requires user location)' })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    @Max(500)
    maxDistance?: number;

    @ApiPropertyOptional({ description: 'Search text in bio' })
    @IsOptional()
    @IsString()
    q?: string;

    @ApiPropertyOptional({ description: 'Search by name (first or last)' })
    @IsOptional()
    @IsString()
    name?: string;

    @ApiPropertyOptional({ default: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1;

    @ApiPropertyOptional({ default: 20 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(50)
    limit?: number = 20;
}

import { IsEnum, IsOptional, IsString, MaxLength, IsBoolean, IsNumber, IsEmail } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContentType } from '../../../database/entities/app-content.entity';
import { JobType } from '../../../database/entities/job-vacancy.entity';
import { PartnerType } from '../../../database/entities/partner.entity';

export class CreateContentDto {
    @ApiProperty({ enum: ContentType })
    @IsEnum(ContentType)
    type: ContentType;

    @ApiProperty()
    @IsString()
    @MaxLength(200)
    title: string;

    @ApiProperty()
    @IsString()
    content: string;

    @ApiPropertyOptional({ default: 'en' })
    @IsOptional()
    @IsString()
    locale?: string;

    @ApiPropertyOptional({ default: true })
    @IsOptional()
    @IsBoolean()
    isPublished?: boolean;
}

export class UpdateContentDto {
    @ApiPropertyOptional({ enum: ContentType })
    @IsOptional()
    @IsEnum(ContentType)
    type?: ContentType;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    @MaxLength(200)
    title?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    content?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isPublished?: boolean;

    @ApiPropertyOptional({ default: 'en' })
    @IsOptional()
    @IsString()
    locale?: string;
}

// ─── FAQ DTOs ────────────────────────────────────────────

export class CreateFaqDto {
    @ApiProperty()
    @IsString()
    question: string;

    @ApiProperty()
    @IsString()
    answer: string;

    @ApiPropertyOptional({ default: 'general' })
    @IsOptional()
    @IsString()
    category?: string;

    @ApiPropertyOptional({ default: 'en' })
    @IsOptional()
    @IsString()
    locale?: string;

    @ApiPropertyOptional({ default: 0 })
    @IsOptional()
    @IsNumber()
    order?: number;

    @ApiPropertyOptional({ default: true })
    @IsOptional()
    @IsBoolean()
    isPublished?: boolean;
}

export class UpdateFaqDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    question?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    answer?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    category?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    order?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isPublished?: boolean;

    @ApiPropertyOptional({ default: 'en' })
    @IsOptional()
    @IsString()
    locale?: string;
}

// ─── Job Vacancy DTOs ────────────────────────────────────

export class CreateJobDto {
    @ApiProperty()
    @IsString()
    title: string;

    @ApiProperty()
    @IsString()
    description: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    requirements?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    benefits?: string;

    @ApiPropertyOptional({ enum: JobType, default: JobType.FULL_TIME })
    @IsOptional()
    @IsEnum(JobType)
    type?: JobType;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    location?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    department?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    salaryRange?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    applicationUrl?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    applicationEmail?: string;

    @ApiPropertyOptional({ default: 'en' })
    @IsOptional()
    @IsString()
    locale?: string;

    @ApiPropertyOptional({ default: true })
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

export class UpdateJobDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    title?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    description?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    requirements?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    benefits?: string;

    @ApiPropertyOptional({ enum: JobType })
    @IsOptional()
    @IsEnum(JobType)
    type?: JobType;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    location?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    department?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    salaryRange?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    applicationUrl?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    applicationEmail?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;

    @ApiPropertyOptional({ default: 'en' })
    @IsOptional()
    @IsString()
    locale?: string;
}

// ─── Partner DTOs ────────────────────────────────────────

export class CreatePartnerDto {
    @ApiProperty()
    @IsString()
    name: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    description?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    logoUrl?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    websiteUrl?: string;

    @ApiPropertyOptional({ enum: PartnerType, default: PartnerType.SPONSOR })
    @IsOptional()
    @IsEnum(PartnerType)
    type?: PartnerType;

    @ApiPropertyOptional({ default: 0 })
    @IsOptional()
    @IsNumber()
    order?: number;
}

export class UpdatePartnerDto {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    name?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    description?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    logoUrl?: string;

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    websiteUrl?: string;

    @ApiPropertyOptional({ enum: PartnerType })
    @IsOptional()
    @IsEnum(PartnerType)
    type?: PartnerType;

    @ApiPropertyOptional()
    @IsOptional()
    @IsNumber()
    order?: number;

    @ApiPropertyOptional()
    @IsOptional()
    @IsBoolean()
    isActive?: boolean;
}

import { IsString, IsNotEmpty, MinLength, MaxLength, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TicketStatus } from '../../../database/entities/support-ticket.entity';

export class CreateSupportTicketDto {
    @ApiProperty({ description: 'Subject of the support ticket' })
    @IsString()
    @IsNotEmpty()
    @MinLength(3)
    @MaxLength(200)
    subject: string;

    @ApiProperty({ description: 'Detailed message' })
    @IsString()
    @IsNotEmpty()
    @MinLength(10)
    @MaxLength(2000)
    message: string;
}

export class UpdateTicketStatusDto {
    @ApiProperty({ enum: TicketStatus })
    @IsEnum(TicketStatus)
    status: TicketStatus;

    @ApiPropertyOptional({ description: 'Admin reply to the ticket' })
    @IsOptional()
    @IsString()
    @MaxLength(2000)
    adminReply?: string;
}

import {
    Controller,
    Post,
    Get,
    Patch,
    Param,
    Body,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SupportService } from './support.service';
import { CreateSupportTicketDto, UpdateTicketStatusDto } from './dto/support.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { TicketStatus } from '../../database/entities/support-ticket.entity';

@ApiTags('support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('support')
export class SupportController {
    constructor(private readonly supportService: SupportService) { }

    @Post()
    @ApiOperation({ summary: 'Create a support ticket' })
    async createTicket(
        @CurrentUser('sub') userId: string,
        @Body() dto: CreateSupportTicketDto,
    ) {
        return this.supportService.createTicket(userId, dto);
    }

    @Get('my-tickets')
    @ApiOperation({ summary: 'Get my support tickets' })
    async getMyTickets(
        @CurrentUser('sub') userId: string,
        @Query() pagination: PaginationDto,
    ) {
        return this.supportService.getMyTickets(userId, pagination);
    }

    @Get('my-tickets/:id')
    @ApiOperation({ summary: 'Get a specific ticket' })
    async getTicket(
        @CurrentUser('sub') userId: string,
        @Param('id') ticketId: string,
    ) {
        return this.supportService.getTicketById(userId, ticketId);
    }

    // ─── Admin endpoints ────────────────────────────────────

    @Get()
    @ApiOperation({ summary: 'Get all tickets (admin)' })
    async getAllTickets(
        @Query() pagination: PaginationDto,
        @Query('status') status?: TicketStatus,
    ) {
        return this.supportService.getAllTickets(pagination, status);
    }

    @Get('stats')
    @ApiOperation({ summary: 'Get ticket stats (admin)' })
    async getStats() {
        return this.supportService.getTicketStats();
    }

    @Patch(':id/status')
    @ApiOperation({ summary: 'Update ticket status (admin)' })
    async updateStatus(
        @Param('id') ticketId: string,
        @Body() dto: UpdateTicketStatusDto,
    ) {
        return this.supportService.updateTicketStatus(ticketId, dto);
    }
}

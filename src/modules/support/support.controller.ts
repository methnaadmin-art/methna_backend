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
import { CreateSupportTicketDto, UpdateTicketStatusDto, CreateFeedbackDto } from './dto/support.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { TicketStatus } from '../../database/entities/support-ticket.entity';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../database/entities/user.entity';

@ApiTags('support')
@Controller('support')
export class SupportController {
    constructor(private readonly supportService: SupportService) { }

    // ─── Public: Create ticket from website (no auth) ──────

    @Post('public')
    @ApiOperation({ summary: 'Create a support ticket from website (no auth required)' })
    async createPublicTicket(
        @Body() body: { name: string; email: string; subject: string; message: string; accountEmail?: string },
    ) {
        const subject = body.subject || 'Website Support Request';
        const message = [
            `From: ${body.name || 'Anonymous'} (${body.email || 'no email'})`,
            body.accountEmail ? `Account email: ${body.accountEmail}` : '',
            '',
            body.message || '',
        ].filter(Boolean).join('\n');

        return this.supportService.createPublicTicket(subject, message, body.email);
    }

    // ─── Authenticated endpoints ────────────────────────────

    @Post()
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
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
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Get all tickets (admin)' })
    async getAllTickets(
        @Query() pagination: PaginationDto,
        @Query('status') status?: TicketStatus,
    ) {
        return this.supportService.getAllTickets(pagination, status);
    }

    @Get('stats')
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Get ticket stats (admin)' })
    async getStats() {
        return this.supportService.getTicketStats();
    }

    @Patch(':id/status')
    @UseGuards(RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Update ticket status (admin)' })
    async updateStatus(
        @Param('id') ticketId: string,
        @Body() dto: UpdateTicketStatusDto,
    ) {
        return this.supportService.updateTicketStatus(ticketId, dto);
    }

    // ─── Feedback endpoint ───────────────────────────────────

    @Post('feedback')
    @ApiOperation({ summary: 'Submit feedback, bug report, or suggestion' })
    async submitFeedback(
        @CurrentUser('sub') userId: string,
        @Body() dto: CreateFeedbackDto,
    ) {
        return this.supportService.submitFeedback(userId, dto);
    }
}

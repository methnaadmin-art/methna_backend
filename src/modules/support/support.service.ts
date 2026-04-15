import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupportTicket, TicketStatus } from '../../database/entities/support-ticket.entity';
import { CreateSupportTicketDto, UpdateTicketStatusDto, CreateFeedbackDto } from './dto/support.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class SupportService {
    constructor(
        @InjectRepository(SupportTicket)
        private readonly ticketRepository: Repository<SupportTicket>,
        private readonly notificationsService: NotificationsService,
    ) { }

    async createTicket(userId: string, dto: CreateSupportTicketDto): Promise<SupportTicket> {
        const ticket = this.ticketRepository.create({
            userId,
            subject: dto.subject,
            message: dto.message,
        });
        return this.ticketRepository.save(ticket);
    }

    async createPublicTicket(subject: string, message: string, email?: string): Promise<SupportTicket> {
        const ticket = this.ticketRepository.create({
            userId: undefined,
            contactEmail: email || undefined,
            subject,
            message,
            status: TicketStatus.OPEN,
        });
        return this.ticketRepository.save(ticket);
    }

    async getMyTickets(userId: string, pagination: PaginationDto) {
        const [tickets, total] = await this.ticketRepository.findAndCount({
            where: { userId },
            order: { createdAt: 'DESC' },
            skip: pagination.skip,
            take: pagination.limit,
        });
        return { tickets, total, page: pagination.page, limit: pagination.limit };
    }

    async getTicketById(userId: string, ticketId: string): Promise<SupportTicket> {
        const ticket = await this.ticketRepository.findOne({
            where: { id: ticketId },
            relations: ['user'],
        });
        if (!ticket) throw new NotFoundException('Ticket not found');
        if (ticket.userId !== userId) throw new ForbiddenException('Access denied');
        return ticket;
    }

    // ─── Admin Methods ──────────────────────────────────────

    async getAllTickets(pagination: PaginationDto, status?: TicketStatus) {
        const where = status ? { status } : {};
        const [tickets, total] = await this.ticketRepository.findAndCount({
            where,
            relations: ['user'],
            order: { createdAt: 'DESC' },
            skip: pagination.skip,
            take: pagination.limit,
        });
        return { tickets, total, page: pagination.page, limit: pagination.limit };
    }

    async updateTicketStatus(ticketId: string, dto: UpdateTicketStatusDto): Promise<SupportTicket> {
        const ticket = await this.ticketRepository.findOne({ where: { id: ticketId } });
        if (!ticket) throw new NotFoundException('Ticket not found');

        ticket.status = dto.status;
        if (dto.adminReply) {
            ticket.adminReply = dto.adminReply;
            ticket.repliedAt = new Date();
        }
        const savedTicket = await this.ticketRepository.save(ticket);

        if (dto.adminReply) {
            await this.notificationsService.sendTicketNotification(
                ticket.userId,
                'Support Reply',
                `Your ticket "${ticket.subject}" has been answered.`,
                { ticketId: ticket.id, status: ticket.status },
            );
        }

        return savedTicket;
    }

    async getTicketStats() {
        const open = await this.ticketRepository.count({ where: { status: TicketStatus.OPEN } });
        const inProgress = await this.ticketRepository.count({ where: { status: TicketStatus.IN_PROGRESS } });
        const resolved = await this.ticketRepository.count({ where: { status: TicketStatus.RESOLVED } });
        const closed = await this.ticketRepository.count({ where: { status: TicketStatus.CLOSED } });
        return { open, inProgress, resolved, closed, total: open + inProgress + resolved + closed };
    }

    // ─── Feedback ────────────────────────────────────────────

    async submitFeedback(userId: string, dto: CreateFeedbackDto): Promise<SupportTicket> {
        const ticket = this.ticketRepository.create({
            userId,
            subject: `[${dto.type.toUpperCase()}] User Feedback`,
            message: dto.message + (dto.email ? `\n\nContact email: ${dto.email}` : ''),
        });
        return this.ticketRepository.save(ticket);
    }
}

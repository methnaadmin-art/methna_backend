import {
    Injectable,
    BadRequestException,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Report, ReportReason } from '../../database/entities/report.entity';
import { BlockedUser } from '../../database/entities/blocked-user.entity';
import { Match, MatchStatus } from '../../database/entities/match.entity';
import { CreateReportDto, UpdateReportStatusDto } from './dto/report.dto';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class ReportsService {
    constructor(
        @InjectRepository(Report)
        private readonly reportRepository: Repository<Report>,
        @InjectRepository(BlockedUser)
        private readonly blockedUserRepository: Repository<BlockedUser>,
        @InjectRepository(Match)
        private readonly matchRepository: Repository<Match>,
    ) { }

    // ─── User Reports ──────────────────────────────────────
    async createReport(userId: string, dto: CreateReportDto): Promise<Report> {
        const isFeedback = [
            ReportReason.FEEDBACK,
            ReportReason.BUG,
            ReportReason.SUGGESTION,
        ].includes(dto.reason);

        // For user reports, reportedId is required and can't be self
        if (!isFeedback) {
            if (!dto.reportedId) {
                throw new BadRequestException('reportedId is required for user reports');
            }
            if (userId === dto.reportedId) {
                throw new BadRequestException('Cannot report yourself');
            }
            // Check for existing pending report
            const existing = await this.reportRepository.findOne({
                where: { reporterId: userId, reportedId: dto.reportedId, status: 'pending' as any },
            });
            if (existing) {
                throw new BadRequestException('Report already pending for this user');
            }
        }

        const report = this.reportRepository.create({
            reporterId: userId,
            reportedId: isFeedback ? undefined : dto.reportedId,
            reason: dto.reason,
            details: dto.details,
        });

        return this.reportRepository.save(report);
    }

    async getMyReports(userId: string) {
        return this.reportRepository.find({
            where: { reporterId: userId },
            order: { createdAt: 'DESC' },
            take: 50,
        });
    }

    // ─── Admin ─────────────────────────────────────────────
    async getAllReports(page: number = 1, limit: number = 20): Promise<{ data: Report[]; total: number }> {
        const [data, total] = await this.reportRepository.findAndCount({
            relations: ['reporter', 'reported'],
            order: { createdAt: 'DESC' },
            skip: (page - 1) * limit,
            take: limit,
        });
        return { data, total };
    }

    async updateReportStatus(reportId: string, dto: UpdateReportStatusDto): Promise<Report> {
        const report = await this.reportRepository.findOne({ where: { id: reportId } });
        if (!report) throw new NotFoundException('Report not found');
        report.status = dto.status;
        if (dto.moderatorNote) report.moderatorNote = dto.moderatorNote;
        return this.reportRepository.save(report);
    }

    // ─── Blocking ──────────────────────────────────────────
    async blockUser(userId: string, blockedId: string): Promise<void> {
        if (userId === blockedId) {
            throw new BadRequestException('Cannot block yourself');
        }

        const existing = await this.blockedUserRepository.findOne({
            where: { blockerId: userId, blockedId },
        });
        if (existing) {
            return; // Already blocked — idempotent success
        }

        const block = this.blockedUserRepository.create({
            blockerId: userId,
            blockedId,
        });
        await this.blockedUserRepository.save(block);

        // Auto-unmatch: set all active matches between these users to UNMATCHED
        const activeMatches = await this.matchRepository.find({
            where: [
                { user1Id: userId, user2Id: blockedId, status: MatchStatus.ACTIVE },
                { user1Id: blockedId, user2Id: userId, status: MatchStatus.ACTIVE },
            ],
        });
        for (const match of activeMatches) {
            match.status = MatchStatus.UNMATCHED;
        }
        if (activeMatches.length > 0) {
            await this.matchRepository.save(activeMatches);
        }
    }

    async unblockUser(userId: string, blockedId: string): Promise<void> {
        const block = await this.blockedUserRepository.findOne({
            where: { blockerId: userId, blockedId },
        });
        if (!block) throw new NotFoundException('User is not blocked');
        await this.blockedUserRepository.remove(block);
    }

    async getBlockedUsers(userId: string) {
        return this.blockedUserRepository.find({
            where: { blockerId: userId },
            relations: ['blocked'],
            order: { createdAt: 'DESC' },
        });
    }
}

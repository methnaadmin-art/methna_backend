import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus } from '../../database/entities/user.entity';
import { Report, ReportStatus } from '../../database/entities/report.entity';
import { Profile } from '../../database/entities/profile.entity';
import { Match } from '../../database/entities/match.entity';
import { Subscription, SubscriptionPlan } from '../../database/entities/subscription.entity';
import { Photo, PhotoModerationStatus } from '../../database/entities/photo.entity';
import { Like } from '../../database/entities/like.entity';
import { Message } from '../../database/entities/message.entity';
import { PaginationDto } from '../../common/dto/pagination.dto';

@Injectable()
export class AdminService {
    private readonly logger = new Logger(AdminService.name);

    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(Report)
        private readonly reportRepository: Repository<Report>,
        @InjectRepository(Profile)
        private readonly profileRepository: Repository<Profile>,
        @InjectRepository(Match)
        private readonly matchRepository: Repository<Match>,
        @InjectRepository(Subscription)
        private readonly subscriptionRepository: Repository<Subscription>,
        @InjectRepository(Photo)
        private readonly photoRepository: Repository<Photo>,
        @InjectRepository(Like)
        private readonly likeRepository: Repository<Like>,
        @InjectRepository(Message)
        private readonly messageRepository: Repository<Message>,
    ) { }

    // ─── USER MANAGEMENT ────────────────────────────────────

    async getUsers(pagination: PaginationDto, status?: UserStatus) {
        const where: any = {};
        if (status) where.status = status;

        const [users, total] = await this.userRepository.findAndCount({
            where,
            order: { createdAt: 'DESC' },
            skip: pagination.skip,
            take: pagination.limit,
        });

        return { users, total, page: pagination.page, limit: pagination.limit };
    }

    async getUserDetail(userId: string) {
        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        const profile = await this.profileRepository.findOne({ where: { userId } });
        const photos = await this.photoRepository.find({ where: { userId } });
        const subscription = await this.subscriptionRepository.findOne({ where: { userId } });

        return { user, profile, photos, subscription };
    }

    async updateUserStatus(userId: string, status: UserStatus): Promise<User | null> {
        await this.userRepository.update(userId, { status });
        return this.userRepository.findOne({ where: { id: userId } });
    }

    async deleteUserAccount(userId: string): Promise<void> {
        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        // Soft delete the user (uses @DeleteDateColumn)
        await this.userRepository.softDelete(userId);
        this.logger.warn(`Admin deleted user account: ${userId}`);
    }

    // ─── REPORTS ────────────────────────────────────────────

    async getReports(pagination: PaginationDto, status?: ReportStatus) {
        const where: any = {};
        if (status) where.status = status;

        const [reports, total] = await this.reportRepository.findAndCount({
            where,
            relations: ['reporter', 'reported'],
            order: { createdAt: 'DESC' },
            skip: pagination.skip,
            take: pagination.limit,
        });

        return { reports, total, page: pagination.page, limit: pagination.limit };
    }

    async resolveReport(
        reportId: string,
        adminId: string,
        status: ReportStatus,
        moderatorNote?: string,
    ): Promise<Report | null> {
        await this.reportRepository.update(reportId, {
            status,
            moderatorNote,
            resolvedById: adminId,
        });
        return this.reportRepository.findOne({
            where: { id: reportId },
            relations: ['reporter', 'reported'],
        });
    }

    // ─── PHOTO MODERATION ───────────────────────────────────

    async getPendingPhotos(pagination: PaginationDto) {
        const [photos, total] = await this.photoRepository.findAndCount({
            where: { moderationStatus: PhotoModerationStatus.PENDING },
            relations: ['user'],
            order: { createdAt: 'DESC' },
            skip: pagination.skip,
            take: pagination.limit,
        });

        return { photos, total, page: pagination.page, limit: pagination.limit };
    }

    async moderatePhoto(
        photoId: string,
        status: PhotoModerationStatus,
        moderationNote?: string,
    ): Promise<Photo | null> {
        await this.photoRepository.update(photoId, {
            moderationStatus: status,
            moderationNote,
        });
        return this.photoRepository.findOne({ where: { id: photoId } });
    }

    // ─── ANALYTICS / DASHBOARD ──────────────────────────────

    async getDashboardStats() {
        const [
            totalUsers,
            activeUsers,
            suspendedUsers,
            bannedUsers,
            totalProfiles,
            totalMatches,
            pendingReports,
            premiumUsers,
            totalPhotos,
            pendingPhotos,
            totalMessages,
            totalLikes,
        ] = await Promise.all([
            this.userRepository.count(),
            this.userRepository.count({ where: { status: UserStatus.ACTIVE } }),
            this.userRepository.count({ where: { status: UserStatus.SUSPENDED } }),
            this.userRepository.count({ where: { status: UserStatus.BANNED } }),
            this.profileRepository.count(),
            this.matchRepository.count(),
            this.reportRepository.count({ where: { status: ReportStatus.PENDING } }),
            this.subscriptionRepository.count({
                where: [
                    { plan: SubscriptionPlan.PREMIUM, status: 'active' as any },
                    { plan: SubscriptionPlan.GOLD, status: 'active' as any },
                ],
            }),
            this.photoRepository.count(),
            this.photoRepository.count({ where: { moderationStatus: PhotoModerationStatus.PENDING } }),
            this.messageRepository.count(),
            this.likeRepository.count({ where: { isLike: true } }),
        ]);

        // Users registered in last 7 days
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const newUsersThisWeek = await this.userRepository
            .createQueryBuilder('user')
            .where('user.createdAt >= :sevenDaysAgo', { sevenDaysAgo })
            .getCount();

        // Users registered in last 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const newUsersThisMonth = await this.userRepository
            .createQueryBuilder('user')
            .where('user.createdAt >= :thirtyDaysAgo', { thirtyDaysAgo })
            .getCount();

        return {
            users: {
                total: totalUsers,
                active: activeUsers,
                suspended: suspendedUsers,
                banned: bannedUsers,
                newThisWeek: newUsersThisWeek,
                newThisMonth: newUsersThisMonth,
            },
            content: {
                totalProfiles,
                totalMatches,
                totalPhotos,
                pendingPhotos,
                totalMessages,
                totalLikes,
            },
            reports: {
                pending: pendingReports,
            },
            revenue: {
                premiumUsers,
                conversionRate: totalUsers > 0
                    ? ((premiumUsers / totalUsers) * 100).toFixed(2) + '%'
                    : '0%',
            },
        };
    }
}

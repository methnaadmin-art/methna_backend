import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { Match } from '../../database/entities/match.entity';
import { Photo } from '../../database/entities/photo.entity';
import { Profile } from '../../database/entities/profile.entity';
import { Report, ReportStatus } from '../../database/entities/report.entity';
import { Subscription, SubscriptionPlan } from '../../database/entities/subscription.entity';
import {
    User,
    UserStatus,
    VerificationStatus,
    normalizeVerificationState,
} from '../../database/entities/user.entity';
import { RedisService } from '../redis/redis.service';

type VerificationQueueStatus = 'all' | 'pending' | 'approved' | 'rejected';
type VerificationQueueType = 'all' | 'selfie' | 'identity' | 'marital_status';

interface VerificationFilters {
    search?: string;
    status?: string;
    type?: string;
}

@Injectable()
export class AdminService {
    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(Report)
        private readonly reportRepository: Repository<Report>,
        @InjectRepository(Profile)
        private readonly profileRepository: Repository<Profile>,
        @InjectRepository(Match)
        private readonly matchRepository: Repository<Match>,
        @InjectRepository(Photo)
        private readonly photoRepository: Repository<Photo>,
        @InjectRepository(Subscription)
        private readonly subscriptionRepository: Repository<Subscription>,
        private readonly redisService: RedisService,
    ) {}

    async getUsers(pagination: PaginationDto, status?: UserStatus) {
        const where = status ? ({ status } as { status: UserStatus }) : undefined;

        const [users, total] = await this.userRepository.findAndCount({
            where,
            order: { createdAt: 'DESC' },
            skip: pagination.skip,
            take: pagination.limit,
        });

        return {
            users: await this.decorateUsers(users),
            total,
            page: pagination.page,
            limit: pagination.limit,
        };
    }

    async updateUserStatus(userId: string, status: UserStatus): Promise<User | null> {
        await this.userRepository.update(userId, { status });
        await this.redisService.del(`user:${userId}`);
        return this.userRepository.findOne({ where: { id: userId } });
    }

    async getVerifications(
        pagination: PaginationDto,
        filters: VerificationFilters = {},
    ) {
        const users = await this.userRepository.find({
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                selfieVerified: true,
                selfieUrl: true,
                documentUrl: true,
                documentType: true,
                documentVerified: true,
                documentVerifiedAt: true,
                documentRejectionReason: true,
                verification: true,
            },
            order: { createdAt: 'DESC' },
        });

        const queueType = this.normalizeQueueType(filters.type);
        const queueStatus = this.normalizeQueueStatus(filters.status);
        const search = filters.search?.trim().toLowerCase() ?? '';

        const filteredUsers = users.filter((user) => {
            const selfieStatus = this.getSelfieStatus(user);
            const maritalStatus = this.getMaritalStatus(user);

            const matchesSearch =
                search.length === 0 ||
                [user.firstName, user.lastName, user.email]
                    .filter((value): value is string => typeof value === 'string')
                    .some((value) => value.toLowerCase().includes(search));

            if (!matchesSearch) {
                return false;
            }

            if (queueType === 'selfie') {
                return this.matchesStatus(selfieStatus, queueStatus);
            }

            if (queueType === 'marital_status' || queueType === 'identity') {
                return this.matchesStatus(maritalStatus, queueStatus);
            }

            return (
                this.matchesStatus(selfieStatus, queueStatus) ||
                this.matchesStatus(maritalStatus, queueStatus)
            );
        });

        const pagedUsers = filteredUsers.slice(
            pagination.skip,
            pagination.skip + (pagination.limit ?? 20),
        );

        return {
            items: await this.decorateUsers(pagedUsers),
            total: filteredUsers.length,
            page: pagination.page,
            limit: pagination.limit,
        };
    }

    async getPendingVerifications() {
        const pagination = new PaginationDto();
        pagination.page = 1;
        pagination.limit = 250;
        const result = await this.getVerifications(pagination, {
            status: 'pending',
            type: 'all',
        });
        return result.items;
    }

    async getPendingDocuments() {
        const pagination = new PaginationDto();
        pagination.page = 1;
        pagination.limit = 250;
        const result = await this.getVerifications(pagination, {
            status: 'pending',
            type: 'marital_status',
        });
        return result.items;
    }

    async verifySelfie(
        userId: string,
        status: VerificationStatus,
        adminId: string,
        rejectionReason?: string,
    ) {
        return this.updateVerificationState(
            userId,
            'selfie',
            status,
            adminId,
            rejectionReason,
        );
    }

    async verifyMaritalStatus(
        userId: string,
        status: VerificationStatus,
        adminId: string,
        rejectionReason?: string,
    ) {
        return this.updateVerificationState(
            userId,
            'marital_status',
            status,
            adminId,
            rejectionReason,
        );
    }

    async verifyDocument(
        userId: string,
        approved: boolean,
        adminId: string,
        rejectionReason?: string,
    ) {
        return this.updateVerificationState(
            userId,
            'marital_status',
            approved ? VerificationStatus.APPROVED : VerificationStatus.REJECTED,
            adminId,
            rejectionReason,
        );
    }

    async getReports(pagination: PaginationDto, status?: ReportStatus) {
        const where: Partial<Report> = {};
        if (status) {
            where.status = status;
        }

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

    async getDashboardStats() {
        const [
            totalUsers,
            activeUsers,
            totalProfiles,
            totalMatches,
            pendingReports,
            premiumUsers,
        ] = await Promise.all([
            this.userRepository.count(),
            this.userRepository.count({ where: { status: UserStatus.ACTIVE } }),
            this.profileRepository.count(),
            this.matchRepository.count(),
            this.reportRepository.count({ where: { status: ReportStatus.PENDING } }),
            this.subscriptionRepository.count({
                where: [
                    { plan: SubscriptionPlan.PREMIUM, status: 'active' as never },
                    { plan: SubscriptionPlan.GOLD, status: 'active' as never },
                ],
            }),
        ]);

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const newUsersThisWeek = await this.userRepository
            .createQueryBuilder('user')
            .where('user.createdAt >= :sevenDaysAgo', { sevenDaysAgo })
            .getCount();

        return {
            totalUsers,
            activeUsers,
            totalProfiles,
            totalMatches,
            pendingReports,
            premiumUsers,
            newUsersThisWeek,
            conversionRate:
                totalUsers > 0
                    ? `${((premiumUsers / totalUsers) * 100).toFixed(2)}%`
                    : '0%',
        };
    }

    private normalizeQueueType(value?: string): VerificationQueueType {
        if (value === 'selfie') {
            return 'selfie';
        }

        if (value === 'identity') {
            return 'identity';
        }

        if (value === 'marital_status') {
            return 'marital_status';
        }

        return 'all';
    }

    private normalizeQueueStatus(value?: string): VerificationQueueStatus {
        if (value === 'pending' || value === 'approved' || value === 'rejected') {
            return value;
        }

        return 'all';
    }

    private matchesStatus(
        currentStatus: VerificationStatus,
        expectedStatus: VerificationQueueStatus,
    ) {
        if (expectedStatus === 'all') {
            return currentStatus !== VerificationStatus.NOT_SUBMITTED;
        }

        return currentStatus === expectedStatus;
    }

    private getSelfieStatus(user: Partial<User>) {
        const verification = normalizeVerificationState(user.verification);
        if (verification.selfie.status !== VerificationStatus.NOT_SUBMITTED) {
            return verification.selfie.status;
        }

        if (user.selfieVerified) {
            return VerificationStatus.APPROVED;
        }

        if (user.selfieUrl) {
            return VerificationStatus.PENDING;
        }

        return VerificationStatus.NOT_SUBMITTED;
    }

    private getMaritalStatus(user: Partial<User>) {
        const verification = normalizeVerificationState(user.verification);
        if (verification.marital_status.status !== VerificationStatus.NOT_SUBMITTED) {
            return verification.marital_status.status;
        }

        if (user.documentVerified) {
            return VerificationStatus.APPROVED;
        }

        if (user.documentRejectionReason) {
            return VerificationStatus.REJECTED;
        }

        if (user.documentUrl) {
            return VerificationStatus.PENDING;
        }

        return VerificationStatus.NOT_SUBMITTED;
    }

    private async decorateUsers(users: User[]) {
        if (users.length === 0) {
            return [];
        }

        const userIds = users.map((user) => user.id);
        const photos = await this.photoRepository.find({
            where: { userId: In(userIds) },
            order: { isMain: 'DESC', order: 'ASC', createdAt: 'ASC' },
        });

        const firstPhotoByUser = new Map<string, string>();
        for (const photo of photos) {
            if (!firstPhotoByUser.has(photo.userId)) {
                firstPhotoByUser.set(photo.userId, photo.url);
            }
        }

        return users.map((user) => ({
            ...user,
            verification: normalizeVerificationState(user.verification),
            userImageUrl: firstPhotoByUser.get(user.id) ?? null,
        }));
    }

    private async updateVerificationState(
        userId: string,
        field: 'selfie' | 'marital_status',
        status: VerificationStatus,
        adminId: string,
        rejectionReason?: string,
    ) {
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                selfieVerified: true,
                selfieUrl: true,
                documentUrl: true,
                documentType: true,
                documentVerified: true,
                documentVerifiedAt: true,
                documentRejectionReason: true,
                verification: true,
            },
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        const verification = normalizeVerificationState(user.verification);
        const currentItem = verification[field];
        const fallbackUrl = field === 'selfie' ? user.selfieUrl : user.documentUrl;

        if (status !== VerificationStatus.NOT_SUBMITTED && !currentItem.url && !fallbackUrl) {
            throw new BadRequestException(
                field === 'selfie'
                    ? 'User has not uploaded a selfie yet.'
                    : 'User has not uploaded a verification document yet.',
            );
        }

        const now = new Date();
        const nowIso = now.toISOString();
        const nextUrl =
            status === VerificationStatus.NOT_SUBMITTED
                ? null
                : currentItem.url ?? fallbackUrl ?? null;

        verification[field] = {
            ...currentItem,
            status,
            url: nextUrl,
            submittedAt:
                status === VerificationStatus.NOT_SUBMITTED
                    ? null
                    : currentItem.submittedAt ?? nowIso,
            reviewedAt:
                status === VerificationStatus.PENDING ||
                status === VerificationStatus.NOT_SUBMITTED
                    ? null
                    : nowIso,
            reviewedBy:
                status === VerificationStatus.PENDING ||
                status === VerificationStatus.NOT_SUBMITTED
                    ? null
                    : adminId,
            rejectionReason:
                status === VerificationStatus.REJECTED
                    ? rejectionReason ?? 'Rejected by admin review'
                    : null,
        };

        if (field === 'selfie') {
            user.selfieVerified = status === VerificationStatus.APPROVED;
            user.selfieUrl = verification.selfie.url;
        } else {
            user.documentVerified = status === VerificationStatus.APPROVED;
            user.documentVerifiedAt =
                status === VerificationStatus.APPROVED ? now : null;
            user.documentRejectionReason =
                status === VerificationStatus.REJECTED
                    ? rejectionReason ?? 'Rejected by admin review'
                    : null;
            user.documentUrl = verification.marital_status.url;
        }

        user.verification = verification;

        const savedUser = await this.userRepository.save(user);
        await this.redisService.del(`user:${userId}`);
        await this.redisService.set(
            field === 'selfie' ? `selfie_status:${userId}` : `id_doc_status:${userId}`,
            this.toPublicVerificationStatus(status),
            0,
        );

        const [decoratedUser] = await this.decorateUsers([savedUser]);
        return decoratedUser;
    }

    private toPublicVerificationStatus(status: VerificationStatus) {
        switch (status) {
            case VerificationStatus.APPROVED:
                return 'verified';
            case VerificationStatus.REJECTED:
                return 'reverify_required';
            case VerificationStatus.PENDING:
                return 'pending_review';
            case VerificationStatus.NOT_SUBMITTED:
            default:
                return 'not_uploaded';
        }
    }
}

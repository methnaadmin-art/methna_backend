import { Injectable, NotFoundException, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import { Repository, ILike, Not, IsNull, Brackets, In } from 'typeorm';
import * as bcrypt from 'bcrypt';
import {
    User,
    UserRole,
    UserStatus,
    VerificationStatus,
    ModerationReasonCode,
    ActionRequired,
    normalizeVerificationState,
} from '../../database/entities/user.entity';
import { Report, ReportStatus } from '../../database/entities/report.entity';
import { Profile } from '../../database/entities/profile.entity';
import { Match, MatchStatus } from '../../database/entities/match.entity';
import { Subscription, SubscriptionStatus } from '../../database/entities/subscription.entity';
import { Photo, PhotoModerationStatus } from '../../database/entities/photo.entity';
import { Like, LikeType } from '../../database/entities/like.entity';
import { Message, MessageType } from '../../database/entities/message.entity';
import { Boost } from '../../database/entities/boost.entity';
import { Notification, NotificationType } from '../../database/entities/notification.entity';
import { Conversation } from '../../database/entities/conversation.entity';
import { SupportTicket, TicketStatus, TicketPriority } from '../../database/entities/support-ticket.entity';
import { Ad } from '../../database/entities/ad.entity';
import { BlockedUser } from '../../database/entities/blocked-user.entity';
import { RematchRequest, RematchStatus } from '../../database/entities/rematch-request.entity';
import { Plan } from '../../database/entities/plan.entity';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { RedisService } from '../redis/redis.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PlansService } from '../plans/plans.service';
import { ChatService } from '../chat/chat.service';

type SortOrder = 'asc' | 'desc';

interface AdminUserFilters {
    status?: UserStatus;
    search?: string;
    role?: UserRole;
    plan?: string;
    premiumState?: 'all' | 'premium' | 'not_premium' | 'expired';
    verificationState?: 'all' | 'pending' | 'approved' | 'rejected';
    dateFrom?: Date;
    dateTo?: Date;
    sortBy?: string;
    sortOrder?: SortOrder;
}

interface AdminVerificationFilters {
    search?: string;
    status?: 'all' | 'pending' | 'approved' | 'rejected';
    type?: 'all' | 'selfie' | 'identity' | 'marital_status';
    userStatus?: UserStatus;
    dateFrom?: Date;
    dateTo?: Date;
    sortBy?: string;
    sortOrder?: SortOrder;
}

interface AdminNotificationsFilters {
    search?: string;
    userId?: string;
    type?: string;
    isRead?: boolean;
    dateFrom?: Date;
    dateTo?: Date;
    sortBy?: string;
    sortOrder?: SortOrder;
}

interface AdminTicketsFilters {
    status?: TicketStatus;
    priority?: TicketPriority;
    search?: string;
    userId?: string;
    assignedToId?: string;
    dateFrom?: Date;
    dateTo?: Date;
    sortBy?: string;
    sortOrder?: SortOrder;
}

interface AdminSubscriptionsFilters {
    plan?: string;
    userId?: string;
    status?: SubscriptionStatus;
    search?: string;
    dateFrom?: Date;
    dateTo?: Date;
    sortBy?: string;
    sortOrder?: SortOrder;
}

@Injectable()
export class AdminService implements OnModuleInit {
    private readonly logger = new Logger(AdminService.name);
    private static readonly USER_SORT_COLUMNS: Record<string, string> = {
        createdAt: 'user.createdAt',
        updatedAt: 'user.updatedAt',
        lastLoginAt: 'user.lastLoginAt',
        firstName: 'user.firstName',
        email: 'user.email',
        status: 'user.status',
        trustScore: 'user.trustScore',
        premiumExpiryDate: 'user.premiumExpiryDate',
    };

    private static readonly VERIFICATION_SORT_COLUMNS: Record<string, string> = {
        createdAt: 'user.createdAt',
        updatedAt: 'user.updatedAt',
        firstName: 'user.firstName',
        email: 'user.email',
        status: 'user.status',
    };

    private static readonly NOTIFICATION_SORT_COLUMNS: Record<string, string> = {
        createdAt: 'notification.createdAt',
        type: 'notification.type',
        isRead: 'notification.isRead',
    };

    private static readonly TICKET_SORT_COLUMNS: Record<string, string> = {
        createdAt: 'ticket.createdAt',
        updatedAt: 'ticket.updatedAt',
        repliedAt: 'ticket.repliedAt',
        status: 'ticket.status',
        priority: 'ticket.priority',
    };

    private static readonly SUBSCRIPTION_SORT_COLUMNS: Record<string, string> = {
        createdAt: 'subscription.createdAt',
        updatedAt: 'subscription.updatedAt',
        startDate: 'subscription.startDate',
        endDate: 'subscription.endDate',
        status: 'subscription.status',
        plan: 'planEntity.code',
        email: 'user.email',
    };

    private static readonly ADMIN_USER_SELECT = {
        id: true,
        username: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        status: true,
        statusReason: true,
        moderationReasonCode: true,
        moderationReasonText: true,
        actionRequired: true,
        supportMessage: true,
        isUserVisible: true,
        moderationExpiresAt: true,
        internalAdminNote: true,
        updatedByAdminId: true,
        verification: true,
        emailVerified: true,
        selfieVerified: true,
        selfieUrl: true,
        documentUrl: true,
        documentType: true,
        documentVerified: true,
        documentVerifiedAt: true,
        documentRejectionReason: true,
        notificationsEnabled: true,
        isShadowBanned: true,
        trustScore: true,
        flagCount: true,
        lastKnownIp: true,
        deviceCount: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        isPremium: true,
        premiumStartDate: true,
        premiumExpiryDate: true,
    } as const;

    private static readonly ADMIN_USER_QUERY_SELECT_COLUMNS = [
        'user.id',
        'user.username',
        'user.email',
        'user.firstName',
        'user.lastName',
        'user.phone',
        'user.role',
        'user.status',
        'user.statusReason',
        'user.moderationReasonCode',
        'user.moderationReasonText',
        'user.actionRequired',
        'user.supportMessage',
        'user.isUserVisible',
        'user.moderationExpiresAt',
        'user.internalAdminNote',
        'user.updatedByAdminId',
        'user.verification',
        'user.emailVerified',
        'user.selfieVerified',
        'user.selfieUrl',
        'user.documentUrl',
        'user.documentType',
        'user.documentVerified',
        'user.documentVerifiedAt',
        'user.documentRejectionReason',
        'user.notificationsEnabled',
        'user.isShadowBanned',
        'user.trustScore',
        'user.flagCount',
        'user.lastKnownIp',
        'user.deviceCount',
        'user.lastLoginAt',
        'user.createdAt',
        'user.updatedAt',
        'user.deletedAt',
        'user.isPremium',
        'user.premiumStartDate',
        'user.premiumExpiryDate',
    ] as const;

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
        @InjectRepository(Boost)
        private readonly boostRepository: Repository<Boost>,
        @InjectRepository(Notification)
        private readonly notificationRepository: Repository<Notification>,
        @InjectRepository(Conversation)
        private readonly conversationRepository: Repository<Conversation>,
        @InjectRepository(SupportTicket)
        private readonly ticketRepository: Repository<SupportTicket>,
        @InjectRepository(Ad)
        private readonly adRepository: Repository<Ad>,
        @InjectRepository(BlockedUser)
        private readonly blockedUserRepository: Repository<BlockedUser>,
        @InjectRepository(Plan)
        private readonly planRepository: Repository<Plan>,
        @InjectRepository(RematchRequest)
        private readonly rematchRepository: Repository<RematchRequest>,
        private readonly redisService: RedisService,
        private readonly notificationsService: NotificationsService,
        private readonly subscriptionsService: SubscriptionsService,
        private readonly plansService: PlansService,
        private readonly chatService: ChatService,
    ) { }

    // â”€â”€â”€ AUTO-SEED ADMIN ON STARTUP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async onModuleInit() {
        try {
            const adminExists = await this.userRepository.findOne({
                where: { role: UserRole.ADMIN },
                select: ['id'],
            });

            if (!adminExists) {
                const email = process.env.ADMIN_EMAIL || 'admin@methna.app';
                const password = process.env.ADMIN_PASSWORD || 'Admin@123456';

                const salt = await bcrypt.genSalt(12);
                const hashedPassword = await bcrypt.hash(password, salt);

                const admin = this.userRepository.create({
                    email,
                    password: hashedPassword,
                    firstName: 'Super',
                    lastName: 'Admin',
                    username: 'admin',
                    role: UserRole.ADMIN,
                    status: UserStatus.ACTIVE,
                    emailVerified: true,
                    trustScore: 100,
                    notificationsEnabled: true,
                    matchNotifications: true,
                    messageNotifications: true,
                    likeNotifications: true,
                });

                await this.userRepository.save(admin);
                this.logger.warn(`ًں”‘ Auto-seeded admin account: ${email}`);
            }
        } catch (error) {
            this.logger.error('Failed to auto-seed admin:', error.message);
        }
    }

    // â”€â”€â”€ USER MANAGEMENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async getUsers(
        pagination: PaginationDto,
        statusOrFilters?: UserStatus | AdminUserFilters,
        search?: string,
        role?: UserRole,
        plan?: string,
    ) {
        const filters = this.normalizeUserFilters(statusOrFilters, search, role, plan);
        const qb = this.userRepository.createQueryBuilder('user');

        qb.select([...AdminService.ADMIN_USER_QUERY_SELECT_COLUMNS]).distinct(true);

        if (filters.status) {
            qb.andWhere('user.status = :status', { status: filters.status });
        }
        if (filters.role) {
            qb.andWhere('user.role = :role', { role: filters.role });
        }

        const normalizedSearch = filters.search?.trim();
        if (normalizedSearch) {
            const likeSearch = `%${normalizedSearch}%`;
            qb.andWhere(
                new Brackets((searchQb) => {
                    searchQb
                        .where('user.id::text = :exactSearch', { exactSearch: normalizedSearch })
                        .orWhere('user.firstName ILIKE :likeSearch', { likeSearch })
                        .orWhere('user.lastName ILIKE :likeSearch', { likeSearch })
                        .orWhere("CONCAT(user.firstName, ' ', user.lastName) ILIKE :likeSearch", {
                            likeSearch,
                        })
                        .orWhere('user.email ILIKE :likeSearch', { likeSearch })
                        .orWhere('user.username ILIKE :likeSearch', { likeSearch })
                        .orWhere('user.phone ILIKE :likeSearch', { likeSearch });
                }),
            );
        }

        if (filters.plan) {
            qb.innerJoin(
                'subscriptions',
                'sub',
                'sub."userId" = user.id AND sub.status IN (:...subStatuses)',
                { subStatuses: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] },
            );
            qb.leftJoin('plans', 'planEntity', 'planEntity.id = sub."planId"');
            qb.andWhere('(planEntity.code = :plan OR sub.plan = :plan)', { plan: filters.plan });
        }

        if (filters.premiumState && filters.premiumState !== 'all') {
            const now = new Date();
            if (filters.premiumState === 'premium') {
                qb.andWhere(
                    '(user.isPremium = true AND (user.premiumExpiryDate IS NULL OR user.premiumExpiryDate >= :premiumNow))',
                    { premiumNow: now },
                );
            } else if (filters.premiumState === 'not_premium') {
                qb.andWhere('(user.isPremium = false OR user.premiumExpiryDate < :premiumNow)', {
                    premiumNow: now,
                });
            } else if (filters.premiumState === 'expired') {
                qb.andWhere('user.premiumExpiryDate < :premiumNow', { premiumNow: now });
            }
        }

        if (filters.verificationState && filters.verificationState !== 'all') {
            const selfieUrlExpr = `NULLIF(COALESCE(user.verification->'selfie'->>'url', user."selfieUrl"), '')`;
            const identityUrlExpr = `NULLIF(COALESCE(user.verification->'identity'->>'url', user."documentUrl"), '')`;
            const maritalUrlExpr = `NULLIF(user.verification->'marital_status'->>'url', '')`;
            const selfieStatusExpr = `COALESCE(user.verification->'selfie'->>'status', CASE WHEN ${selfieUrlExpr} IS NOT NULL AND user."selfieVerified" = true THEN :approvedStatus WHEN ${selfieUrlExpr} IS NOT NULL THEN :pendingStatus ELSE :notSubmittedStatus END)`;
            const identityStatusExpr = `COALESCE(user.verification->'identity'->>'status', CASE WHEN ${identityUrlExpr} IS NOT NULL AND user."documentVerified" = true THEN :approvedStatus WHEN user."documentRejectionReason" IS NOT NULL THEN :rejectedStatus WHEN ${identityUrlExpr} IS NOT NULL THEN :pendingStatus ELSE :notSubmittedStatus END)`;
            const maritalStatusExpr = `COALESCE(user.verification->'marital_status'->>'status', CASE WHEN ${maritalUrlExpr} IS NOT NULL THEN :pendingStatus ELSE :notSubmittedStatus END)`;
            qb.setParameters({
                approvedStatus: VerificationStatus.APPROVED,
                pendingStatus: VerificationStatus.PENDING,
                rejectedStatus: VerificationStatus.REJECTED,
                notSubmittedStatus: VerificationStatus.NOT_SUBMITTED,
            });

            if (filters.verificationState === 'pending') {
                qb.andWhere(`(${selfieStatusExpr} = :pendingStatus OR ${identityStatusExpr} = :pendingStatus OR ${maritalStatusExpr} = :pendingStatus)`);
            } else if (filters.verificationState === 'approved') {
                qb.andWhere(`(${selfieStatusExpr} = :approvedStatus OR ${identityStatusExpr} = :approvedStatus OR ${maritalStatusExpr} = :approvedStatus)`);
            } else if (filters.verificationState === 'rejected') {
                qb.andWhere(`(${selfieStatusExpr} = :rejectedStatus OR ${identityStatusExpr} = :rejectedStatus OR ${maritalStatusExpr} = :rejectedStatus)`);
            }
        }

        if (filters.dateFrom) {
            qb.andWhere('user.createdAt >= :dateFrom', { dateFrom: filters.dateFrom });
        }
        if (filters.dateTo) {
            qb.andWhere('user.createdAt <= :dateTo', { dateTo: this.endOfDay(filters.dateTo) });
        }

        const sortColumn = this.resolveSortColumn(
            filters.sortBy,
            AdminService.USER_SORT_COLUMNS,
            'user.createdAt',
        );
        const sortOrder = this.resolveSortOrder(filters.sortOrder);

        qb.orderBy(sortColumn, sortOrder)
            .skip(pagination.skip)
            .take(pagination.limit);

        const [users, total] = await qb.getManyAndCount();
        const normalizedUsers = users.map((user) => this.normalizeUserState(user));
        return {
            users: normalizedUsers,
            total,
            page: pagination.page,
            limit: pagination.limit,
        };
    }

    async getUserDetail(userId: string) {
        await this.subscriptionsService.syncUserPremiumState(userId);
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: {
                ...AdminService.ADMIN_USER_SELECT,
                isPremium: true,
                premiumStartDate: true,
                premiumExpiryDate: true,
            },
        });
        if (!user) throw new NotFoundException('User not found');
        const normalizedUser = this.normalizeUserState(user);

        const profile = await this.profileRepository.findOne({ where: { userId } });
        const photos = await this.photoRepository.find({ where: { userId } });
        const subscription = await this.subscriptionRepository.findOne({
            where: { userId },
            order: { createdAt: 'DESC' },
            relations: ['planEntity'],
        });

        // Compute premium display fields
        const now = new Date();
        const premiumExpiryDate = normalizedUser.premiumExpiryDate ? new Date(normalizedUser.premiumExpiryDate) : null;
        const premiumRemainingDays = premiumExpiryDate
            ? Math.max(0, Math.ceil((premiumExpiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
            : 0;
        const premiumIsExpired = premiumExpiryDate ? premiumExpiryDate < now : false;

        return {
            user: normalizedUser,
            profile,
            photos,
            subscription,
            premium: {
                isPremium: normalizedUser.isPremium,
                startDate: normalizedUser.premiumStartDate,
                expiryDate: normalizedUser.premiumExpiryDate,
                remainingDays: premiumRemainingDays,
                isExpired: premiumIsExpired,
            },
        };
    }

    // â”€â”€â”€ DOCUMENT VERIFICATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async getPendingDocuments() {
        const users = await this.userRepository.find({
            where: {
                documentUrl: Not(IsNull()),
                documentVerified: false,
                documentRejectionReason: IsNull(),
            },
            select: AdminService.ADMIN_USER_SELECT,
            order: { createdAt: 'DESC' },
        });

        return users.map((user) => this.normalizeUserState(user));
    }

    async verifyDocument(userId: string, approved: boolean, rejectionReason?: string) {
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: {
                id: true,
                status: true,
                verification: true,
                selfieUrl: true,
                selfieVerified: true,
                documentUrl: true,
                documentType: true,
                documentVerified: true,
                documentVerifiedAt: true,
                documentRejectionReason: true,
            },
        });
        if (!user) throw new NotFoundException('User not found');
        if (!user.documentUrl) throw new BadRequestException('User has no document uploaded');

        const reverifyMessage =
            rejectionReason ||
            "Please upload a clearer passport, national ID, or driver's license.";
        const verification = normalizeVerificationState(user.verification);
        const now = new Date().toISOString();

        user.documentVerified = approved;
        user.documentVerifiedAt = approved ? new Date() : null;
        (user as any).documentRejectionReason = approved
            ? null
            : reverifyMessage;
        user.verification = {
            ...verification,
            identity: {
                ...verification.identity,
                status: approved ? VerificationStatus.APPROVED : VerificationStatus.REJECTED,
                url: user.documentUrl,
                submittedAt: verification.identity.submittedAt || now,
                reviewedAt: now,
                reviewedBy: 'admin',
                rejectionReason: approved ? null : reverifyMessage,
            },
        };

        if (approved && user.status === UserStatus.PENDING_VERIFICATION) {
            user.status = UserStatus.ACTIVE;
        }

        const savedUser = await this.userRepository.save(user);
        await this.redisService.set(
            `id_doc_status:${userId}`,
            approved ? 'verified' : 'reverify_required',
            0,
        );

        await this.notificationsService.createNotification(userId, {
            type: 'verification',
            title: approved ? 'Identity verified' : 'Reverify your identity',
            body: approved
                ? 'Your identity document has been approved by the Methna team.'
                : reverifyMessage,
            data: {
                documentType: user.documentType ?? null,
                status: approved ? 'approved' : 'rejected',
                rejectionReason: approved ? null : reverifyMessage,
                route: '/trust-safety/verification-status',
                targetScreen: 'verification_center',
            },
        });

        this.logger.log(`Admin ${approved ? 'approved' : 'requested reverify for'} identity document of user ${userId}`);
        return this.normalizeUserState(savedUser);
    }

    async autoApproveDocuments() {
        const pending = await this.userRepository.find({
            where: {
                documentUrl: Not(IsNull()),
                documentVerified: false,
                documentRejectionReason: IsNull(),
            },
        });
        let count = 0;
        for (const user of pending) {
            const verification = normalizeVerificationState(user.verification);
            const now = new Date().toISOString();
            user.documentVerified = true;
            user.documentVerifiedAt = new Date();
            (user as any).documentRejectionReason = null;
            user.verification = {
                ...verification,
                identity: {
                    ...verification.identity,
                    status: VerificationStatus.APPROVED,
                    url: user.documentUrl,
                    submittedAt: verification.identity.submittedAt || now,
                    reviewedAt: now,
                    reviewedBy: 'admin:auto',
                    rejectionReason: null,
                },
            };
            if (user.status === UserStatus.PENDING_VERIFICATION) {
                user.status = UserStatus.ACTIVE;
            }
            await this.userRepository.save(user);
            await this.redisService.set(`id_doc_status:${user.id}`, 'verified', 0);
            count++;
        }
        this.logger.log(`Auto-approved ${count} pending documents`);
        return { approved: count };
    }

    // â”€â”€â”€ CREATE USER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async createUser(dto: {
        email: string; password: string; firstName: string; lastName: string;
        username?: string; role?: UserRole | string; status?: UserStatus;
    }) {
        const normalizedEmail = dto.email.trim().toLowerCase();
        const normalizedUsername = dto.username?.trim().toLowerCase() || null;
        const normalizedRole = this.normalizeUserRole(dto.role);

        if (dto.role !== undefined && !normalizedRole) {
            throw new BadRequestException('Invalid role. Use user, admin, moderator, or staff.');
        }

        const exists = await this.userRepository.findOne({ where: { email: normalizedEmail } });
        if (exists) throw new BadRequestException('Email already exists');

        if (normalizedUsername) {
            const existingUsername = await this.userRepository.findOne({
                where: { username: normalizedUsername },
                select: { id: true },
            });
            if (existingUsername) {
                throw new ConflictException('Username already taken');
            }
        }

        const salt = await bcrypt.genSalt(12);
        const hashedPassword = await bcrypt.hash(dto.password, salt);

        const user = this.userRepository.create({
            email: normalizedEmail,
            password: hashedPassword,
            firstName: dto.firstName,
            lastName: dto.lastName,
            username: normalizedUsername ?? undefined,
            role: normalizedRole || UserRole.USER,
            status: dto.status || UserStatus.ACTIVE,
            emailVerified: true,
            trustScore: 100,
            notificationsEnabled: true,
            matchNotifications: true,
            messageNotifications: true,
            likeNotifications: true,
            isPremium: false,
            verification: normalizeVerificationState(null),
        });

        const savedUser = await this.userRepository.save(user);
        this.logger.log(`Admin created user: ${dto.email}`);
        return this.normalizeUserState(savedUser);
    }

    // â”€â”€â”€ UPDATE USER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async updateUser(userId: string, dto: Partial<User> & Record<string, any>) {
        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        const incoming: Record<string, any> = { ...dto };
        delete incoming.password;
        delete incoming.id;

        const premiumEnabled = this.parseBoolean(
            incoming.isPremium ?? incoming.premiumEnabled ?? incoming.premium,
        );
        const premiumStartInput = incoming.premiumStartDate ?? incoming.startDate;
        const premiumExpiryInput = incoming.premiumExpiryDate ?? incoming.expiryDate;
        const hasPremiumUpdate =
            premiumEnabled !== undefined ||
            premiumStartInput !== undefined ||
            premiumExpiryInput !== undefined;

        delete incoming.isPremium;
        delete incoming.premiumEnabled;
        delete incoming.premium;
        delete incoming.premiumStartDate;
        delete incoming.premiumExpiryDate;
        delete incoming.startDate;
        delete incoming.expiryDate;

        if (incoming.role !== undefined) {
            const normalizedRole = this.normalizeUserRole(incoming.role);
            if (!normalizedRole) {
                throw new BadRequestException('Invalid role. Use user, admin, moderator, or staff.');
            }
            incoming.role = normalizedRole;
        }

        if (incoming.email !== undefined) {
            incoming.email = String(incoming.email).trim().toLowerCase();
            if (!incoming.email) {
                throw new BadRequestException('Email cannot be empty');
            }

            const existingEmail = await this.userRepository.findOne({
                where: { email: incoming.email },
                select: { id: true },
            });
            if (existingEmail && existingEmail.id !== userId) {
                throw new ConflictException('Email already exists');
            }
        }

        if (incoming.username !== undefined) {
            const normalizedUsername = String(incoming.username || '').trim().toLowerCase();
            incoming.username = normalizedUsername || null;

            if (incoming.username) {
                const existingUsername = await this.userRepository.findOne({
                    where: { username: incoming.username },
                    select: { id: true },
                });
                if (existingUsername && existingUsername.id !== userId) {
                    throw new ConflictException('Username already taken');
                }
            }
        }

        const nestedProfile = incoming.profile && typeof incoming.profile === 'object'
            ? incoming.profile
            : null;
        delete incoming.profile;

        const profileFields = new Set([
            'bio', 'gender', 'dateOfBirth', 'maritalStatus', 'religiousLevel',
            'ethnicity', 'nationality', 'nationalities', 'sect', 'prayerFrequency',
            'dietary', 'alcohol', 'hijabStatus', 'company', 'familyValues',
            'height', 'weight', 'livingSituation', 'jobTitle', 'education',
            'educationDetails', 'familyPlans', 'communicationStyle',
            'marriageIntention', 'secondWifePreference', 'intentMode',
            'vaccinationStatus', 'bloodType', 'healthNotes', 'workoutFrequency',
            'sleepSchedule', 'socialMediaUsage', 'hasPets', 'petPreference',
            'interests', 'languages', 'favoriteMusic', 'favoriteMovies',
            'favoriteBooks', 'travelPreferences', 'hasChildren', 'numberOfChildren',
            'wantsChildren', 'willingToRelocate', 'city', 'country', 'latitude',
            'longitude', 'aboutPartner', 'showAge', 'showDistance',
            'showOnlineStatus', 'showLastSeen', 'profileCompletionPercentage',
            'activityScore', 'isComplete',
        ]);

        const profileUpdate: Record<string, any> = {};
        if (nestedProfile) Object.assign(profileUpdate, nestedProfile);
        for (const field of profileFields) {
            if (incoming[field] !== undefined) {
                profileUpdate[field] = incoming[field];
                delete incoming[field];
            }
        }

        if (incoming.verification !== undefined) {
            incoming.verification = normalizeVerificationState(incoming.verification);
        }

        if (hasPremiumUpdate) {
            if (premiumEnabled === false) {
                await this.subscriptionsService.removePremium(userId);
            } else {
                const premiumStartDate = this.parseDateInput(
                    premiumStartInput,
                    user.premiumStartDate ?? new Date(),
                );
                const premiumExpiryDate = this.parseDateInput(premiumExpiryInput, null);

                if (!premiumExpiryDate) {
                    throw new BadRequestException('premiumExpiryDate is required when enabling premium');
                }
                if (premiumStartDate && premiumExpiryDate <= premiumStartDate) {
                    throw new BadRequestException('premiumExpiryDate must be later than premiumStartDate');
                }

                await this.subscriptionsService.setManualPremium(
                    userId,
                    premiumStartDate ?? new Date(),
                    premiumExpiryDate,
                );
            }
        }

        Object.assign(user, incoming);
        await this.userRepository.save(user);

        if (Object.keys(profileUpdate).length > 0) {
            const profile = await this.profileRepository.findOne({ where: { userId } });
            if (!profile) {
                throw new BadRequestException('Cannot update profile fields because this user has no profile yet.');
            }
            Object.assign(profile, profileUpdate);
            await this.profileRepository.save(profile);
        }

        const savedUser = await this.userRepository.findOne({
            where: { id: userId },
            select: AdminService.ADMIN_USER_SELECT,
        });
        return savedUser ? this.normalizeUserState(savedUser) : null;
    }

    // â”€â”€â”€ PER-USER ACTIVITY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async getUserActivity(userId: string) {
        const [
            likesGiven, likesReceived,
            complimentsGiven, complimentsReceived, passesGiven,
            matchesCount, messagesCount, reportsCount, photosCount,
            boostsCount,
        ] = await Promise.all([
            this.likeRepository.count({ where: { likerId: userId, type: LikeType.LIKE } }),
            this.likeRepository.count({ where: { likedId: userId, type: LikeType.LIKE } }),
            this.likeRepository.count({ where: { likerId: userId, type: LikeType.COMPLIMENT } }),
            this.likeRepository.count({ where: { likedId: userId, type: LikeType.COMPLIMENT } }),
            this.likeRepository.count({ where: { likerId: userId, type: LikeType.PASS } }),
            this.matchRepository.createQueryBuilder('m')
                .where('m.user1Id = :uid OR m.user2Id = :uid', { uid: userId }).getCount(),
            this.messageRepository.count({ where: { senderId: userId } }),
            this.reportRepository.count({ where: { reportedId: userId } }),
            this.photoRepository.count({ where: { userId } }),
            this.boostRepository.count({ where: { userId } }),
        ]);

        const subscription = await this.subscriptionRepository.findOne({ where: { userId } });
        const boost = await this.boostRepository.findOne({
            where: { userId, isActive: true },
            order: { createdAt: 'DESC' },
        });
        const blockedCount = await this.blockedUserRepository.count({ where: { blockerId: userId } });
        const blockedByCount = await this.blockedUserRepository.count({ where: { blockedId: userId } });

        return {
            likes: { given: likesGiven, received: likesReceived },
            compliments: { given: complimentsGiven, received: complimentsReceived },
            passes: passesGiven,
            matches: matchesCount,
            messages: messagesCount,
            reports: reportsCount,
            photos: photosCount,
            boosts: boostsCount,
            blocked: blockedCount,
            blockedBy: blockedByCount,
            subscription: subscription || null,
            activeBoost: boost || null,
        };
    }

    // â”€â”€â”€ SWIPES / ACTIVITY FEED â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async getSwipes(pagination: PaginationDto, type?: LikeType) {
        const where: any = {};
        if (type) where.type = type;

        const [swipes, total] = await this.likeRepository.findAndCount({
            where,
            relations: ['liker', 'liked'],
            order: { createdAt: 'DESC' },
            skip: pagination.skip,
            take: pagination.limit,
        });

        return { swipes, total, page: pagination.page, limit: pagination.limit };
    }

    // â”€â”€â”€ MATCHES (ADMIN VIEW) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async getMatches(pagination: PaginationDto) {
        const [matches, total] = await this.matchRepository.findAndCount({
            relations: ['user1', 'user2'],
            order: { matchedAt: 'DESC' },
            skip: pagination.skip,
            take: pagination.limit,
        });
        return { matches, total, page: pagination.page, limit: pagination.limit };
    }

    // â”€â”€â”€ CONVERSATIONS (ADMIN VIEW) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async getConversations(pagination: PaginationDto, search?: string, filters?: { locked?: boolean; flagged?: boolean }) {
        const qb = this.conversationRepository
            .createQueryBuilder('c')
            .leftJoinAndSelect('c.user1', 'user1')
            .leftJoinAndSelect('c.user2', 'user2')
            .leftJoinAndSelect('user1.profile', 'profile1')
            .leftJoinAndSelect('user2.profile', 'profile2')
            .orderBy('c.lastMessageAt', 'DESC')
            .skip(pagination.skip)
            .take(pagination.limit);

        if (search) {
            const normalizedSearch = search.trim();
            const likeSearch = `%${normalizedSearch}%`;
            qb.andWhere(
                new Brackets((searchQb) => {
                    searchQb
                        .where('c.id::text = :exactSearch', { exactSearch: normalizedSearch })
                        .orWhere('user1.id::text = :exactSearch', { exactSearch: normalizedSearch })
                        .orWhere('user2.id::text = :exactSearch', { exactSearch: normalizedSearch })
                        .orWhere('user1.email ILIKE :likeSearch', { likeSearch })
                        .orWhere('user2.email ILIKE :likeSearch', { likeSearch })
                        .orWhere('user1.username ILIKE :likeSearch', { likeSearch })
                        .orWhere('user2.username ILIKE :likeSearch', { likeSearch })
                        .orWhere('user1.firstName ILIKE :likeSearch', { likeSearch })
                        .orWhere('user1.lastName ILIKE :likeSearch', { likeSearch })
                        .orWhere('user2.firstName ILIKE :likeSearch', { likeSearch })
                        .orWhere('user2.lastName ILIKE :likeSearch', { likeSearch })
                        .orWhere("CONCAT(user1.firstName, ' ', user1.lastName) ILIKE :likeSearch", { likeSearch })
                        .orWhere("CONCAT(user2.firstName, ' ', user2.lastName) ILIKE :likeSearch", { likeSearch });
                }),
            );
        }

        if (filters?.locked === true) {
            qb.andWhere('c.isLocked = true');
        }
        if (filters?.flagged === true) {
            qb.andWhere('c.isFlagged = true');
        }

        const [conversations, total] = await qb.getManyAndCount();
        return { conversations, total, page: pagination.page, limit: pagination.limit };
    }

    async getConversationMessages(conversationId: string, pagination: PaginationDto, search?: string) {
        const normalizedSearch = search?.trim().toLowerCase();
        if (normalizedSearch) {
            const skip = pagination.skip || 0;
            const limit = pagination.limit || 20;
            const allMessages = await this.messageRepository.find({
                where: { conversationId },
                relations: ['sender', 'sender.profile'],
                order: { createdAt: 'ASC' },
            });

            const filtered = allMessages
                .map(message => {
                    message.content = this.chatService.decryptMessageContent(message.content);
                    return message;
                })
                .filter((message) => {
                    const sender = message.sender as any;
                    const haystacks = [
                        message.content,
                        sender?.id,
                        sender?.email,
                        sender?.username,
                        sender?.firstName,
                        sender?.lastName,
                        `${sender?.firstName || ''} ${sender?.lastName || ''}`.trim(),
                    ];

                    return haystacks.some(
                        (value) =>
                            typeof value === 'string' &&
                            value.toLowerCase().includes(normalizedSearch),
                    );
                });

            return {
                messages: filtered.slice(skip, skip + limit),
                total: filtered.length,
                page: pagination.page,
                limit,
            };
        }

        const qb = this.messageRepository
            .createQueryBuilder('m')
            .leftJoinAndSelect('m.sender', 'sender')
            .leftJoinAndSelect('sender.profile', 'senderProfile')
            .where('m.conversationId = :cid', { cid: conversationId })
            .orderBy('m.createdAt', 'ASC')
            .skip(pagination.skip)
            .take(pagination.limit);

        const [messages, total] = await qb.getManyAndCount();
        messages.forEach(message => {
            message.content = this.chatService.decryptMessageContent(message.content);
        });
        return { messages, total, page: pagination.page, limit: pagination.limit };
    }

    async lockConversation(conversationId: string, isLocked: boolean, lockReason?: string) {
        const conversation = await this.conversationRepository.findOne({ where: { id: conversationId } });
        if (!conversation) throw new NotFoundException('Conversation not found');
        conversation.isLocked = isLocked;
        conversation.lockReason = isLocked ? (lockReason || null) : null;
        await this.conversationRepository.save(conversation);
        return { id: conversationId, isLocked, lockReason: isLocked ? lockReason : null };
    }

    async flagConversation(conversationId: string, isFlagged: boolean, flagReason?: string) {
        const conversation = await this.conversationRepository.findOne({ where: { id: conversationId } });
        if (!conversation) throw new NotFoundException('Conversation not found');
        conversation.isFlagged = isFlagged;
        conversation.flagReason = isFlagged ? (flagReason || null) : null;
        await this.conversationRepository.save(conversation);
        return { id: conversationId, isFlagged, flagReason: isFlagged ? flagReason : null };
    }

    // â”€â”€â”€ SEND NOTIFICATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async sendNotification(dto: {
        userId?: string;
        title: string;
        body: string;
        type?: string;
        conversationId?: string;
        extraData?: Record<string, any>;
        broadcast?: boolean;
        filters?: Record<string, any>;
    }) {
        if (dto.broadcast) {
            const users = await this.findFilteredUsers(dto.filters || {});
            const results = await Promise.allSettled(
                users.map(u => this.notificationsService.createNotification(u.id, {
                    type: dto.type || NotificationType.SYSTEM,
                    title: dto.title,
                    body: dto.body,
                    conversationId: dto.conversationId,
                    extraData: dto.extraData,
                })),
            );
            const sent = results.filter(result => result.status === 'fulfilled').length;
            const failed = results.length - sent;
            return { sent, failed, broadcast: true };
        }

        if (!dto.userId) throw new BadRequestException('userId required for non-broadcast');
        const notification = await this.notificationsService.createNotification(dto.userId, {
            type: dto.type || NotificationType.SYSTEM,
            title: dto.title,
            body: dto.body,
            conversationId: dto.conversationId,
            extraData: dto.extraData,
        });
        return { sent: 1, notification };
    }

    private async findFilteredUsers(filters: Record<string, any>) {
        const qb = this.userRepository
            .createQueryBuilder('u')
            .leftJoinAndSelect('u.profile', 'p')
            .where('u.status = :status', { status: UserStatus.ACTIVE })
            .distinct(true);

        const premiumOnly = this.parseBoolean(filters?.premiumOnly) === true;
        const recentOnly = this.parseBoolean(filters?.recentOnly) === true;
        const recentDays = Number(filters?.recentDays);
        const ageMin = filters?.ageMin !== undefined ? Number(filters.ageMin) : null;
        const ageMax = filters?.ageMax !== undefined ? Number(filters.ageMax) : null;

        if (ageMin !== null && (!Number.isFinite(ageMin) || ageMin < 18)) {
            throw new BadRequestException('ageMin must be a number greater than or equal to 18');
        }
        if (ageMax !== null && (!Number.isFinite(ageMax) || ageMax < 18)) {
            throw new BadRequestException('ageMax must be a number greater than or equal to 18');
        }
        if (ageMin !== null && ageMax !== null && ageMin > ageMax) {
            throw new BadRequestException('ageMin cannot be greater than ageMax');
        }

        if (ageMin !== null) {
            qb.andWhere(`(p.dateOfBirth IS NULL OR date_part('year', age(p.dateOfBirth)) >= :ageMin)`, { ageMin });
        }
        if (ageMax !== null) {
            qb.andWhere(`(p.dateOfBirth IS NULL OR date_part('year', age(p.dateOfBirth)) <= :ageMax)`, { ageMax });
        }
        if (filters.gender && filters.gender !== 'all') {
            qb.andWhere('LOWER(p.gender) = LOWER(:gender)', { gender: String(filters.gender).trim() });
        }
        if (premiumOnly) {
            qb.innerJoin(
                'subscriptions',
                's',
                's."userId" = u.id AND s.status IN (:...premiumStatuses)',
                {
                    premiumStatuses: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
                },
            );
            qb.leftJoin('plans', 'sp', 'sp.id = s."planId"');
            qb.andWhere("COALESCE(sp.code, s.plan, 'free') != :freePlan", { freePlan: 'free' });
        }
        if (filters.country) {
            qb.andWhere('p.country ILIKE :country', { country: `%${filters.country}%` });
        }
        if (filters.city) {
            qb.andWhere('p.city ILIKE :city', { city: `%${filters.city}%` });
        }
        if (recentOnly) {
            const since = new Date();
            since.setDate(since.getDate() - (Number.isFinite(recentDays) && recentDays > 0 ? recentDays : 30));
            qb.andWhere('u.lastLoginAt >= :since', { since });
        }

        return qb.select(['u.id']).getMany();
    }

    async previewNotificationRecipients(filters: Record<string, any>) {
        const users = await this.findFilteredUsers(filters);
        return { recipientCount: users.length, filters };
    }

    // â”€â”€â”€ SUPPORT TICKETS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async getTickets(
        pagination: PaginationDto,
        statusOrFilters?: TicketStatus | AdminTicketsFilters,
    ) {
        const filters: AdminTicketsFilters =
            typeof statusOrFilters === 'string'
                ? { status: statusOrFilters }
                : statusOrFilters || {};

        const qb = this.ticketRepository
            .createQueryBuilder('ticket')
            .leftJoinAndSelect('ticket.user', 'user')
            .leftJoinAndSelect('ticket.assignedTo', 'assignedTo');

        if (filters.status) {
            qb.andWhere('ticket.status = :status', { status: filters.status });
        }
        if (filters.priority) {
            qb.andWhere('ticket.priority = :priority', { priority: filters.priority });
        }
        if (filters.userId) {
            qb.andWhere('ticket.userId = :userId', { userId: filters.userId });
        }
        if (filters.assignedToId) {
            qb.andWhere('ticket.assignedToId = :assignedToId', { assignedToId: filters.assignedToId });
        }

        const normalizedSearch = filters.search?.trim();
        if (normalizedSearch) {
            const likeSearch = `%${normalizedSearch}%`;
            qb.andWhere(
                new Brackets((searchQb) => {
                    searchQb
                        .where('ticket.subject ILIKE :likeSearch', { likeSearch })
                        .orWhere('ticket.message ILIKE :likeSearch', { likeSearch })
                        .orWhere('ticket.id::text = :exactSearch', { exactSearch: normalizedSearch })
                        .orWhere('user.email ILIKE :likeSearch', { likeSearch })
                        .orWhere('user.username ILIKE :likeSearch', { likeSearch })
                        .orWhere('assignedTo.email ILIKE :likeSearch', { likeSearch })
                        .orWhere('assignedTo.username ILIKE :likeSearch', { likeSearch })
                        .orWhere("CONCAT(user.firstName, ' ', user.lastName) ILIKE :likeSearch", {
                            likeSearch,
                        })
                        .orWhere("CONCAT(assignedTo.firstName, ' ', assignedTo.lastName) ILIKE :likeSearch", {
                            likeSearch,
                        });
                }),
            );
        }

        if (filters.dateFrom) {
            qb.andWhere('ticket.createdAt >= :dateFrom', { dateFrom: filters.dateFrom });
        }
        if (filters.dateTo) {
            qb.andWhere('ticket.createdAt <= :dateTo', { dateTo: this.endOfDay(filters.dateTo) });
        }

        const sortColumn = this.resolveSortColumn(
            filters.sortBy,
            AdminService.TICKET_SORT_COLUMNS,
            'ticket.createdAt',
        );
        const sortOrder = this.resolveSortOrder(filters.sortOrder);

        qb.orderBy(sortColumn, sortOrder)
            .skip(pagination.skip)
            .take(pagination.limit);

        const [tickets, total] = await qb.getManyAndCount();
        return { tickets, total, page: pagination.page, limit: pagination.limit };
    }

    async replyToTicket(ticketId: string, adminId: string, reply: string, newStatus?: TicketStatus) {
        const ticket = await this.ticketRepository.findOne({ where: { id: ticketId } });
        if (!ticket) throw new NotFoundException('Ticket not found');

        ticket.adminReply = reply;
        ticket.assignedToId = adminId;
        ticket.repliedAt = new Date();
        ticket.status = newStatus || TicketStatus.RESOLVED;

        await this.ticketRepository.save(ticket);

        // Also send notification to user
        await this.notificationsService.sendTicketNotification(
            ticket.userId,
            'Support Reply',
            `Your ticket "${ticket.subject}" has been answered.`,
            { ticketId: ticket.id, status: ticket.status },
        );

        return this.ticketRepository.findOne({
            where: { id: ticket.id },
            relations: ['user', 'assignedTo'],
        });
    }

    async createTicket(userId: string, subject: string, message: string) {
        const ticket = this.ticketRepository.create({ userId, subject, message });
        return this.ticketRepository.save(ticket);
    }

    // â”€â”€â”€ ADS MANAGEMENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async getAds() {
        return this.adRepository.find({ order: { createdAt: 'DESC' } });
    }

    async createAd(dto: Partial<Ad>) {
        const ad = this.adRepository.create(dto);
        const saved = await this.adRepository.save(ad);
        await this.redisService.delByPattern('ads:feed:*');
        return saved;
    }

    async updateAd(id: string, dto: Partial<Ad>) {
        const ad = await this.adRepository.findOne({ where: { id } });
        if (!ad) throw new NotFoundException('Ad not found');
        Object.assign(ad, dto);
        const saved = await this.adRepository.save(ad);
        await this.redisService.delByPattern('ads:feed:*');
        return saved;
    }

    async deleteAd(id: string) {
        const res = await this.adRepository.delete(id);
        if (res.affected === 0) throw new NotFoundException('Ad not found');
        await this.redisService.delByPattern('ads:feed:*');
    }

    // â”€â”€â”€ BOOSTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async getBoosts(pagination: PaginationDto) {
        const [boosts, total] = await this.boostRepository.findAndCount({
            relations: ['user'],
            order: { createdAt: 'DESC' },
            skip: pagination.skip,
            take: pagination.limit,
        });
        return { boosts, total, page: pagination.page, limit: pagination.limit };
    }

    // â”€â”€â”€ PLAN MANAGEMENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async getPlans() {
        return this.plansService.getAllPlans();
    }

    async createPlan(dto: Partial<Plan>) {
        return this.plansService.createPlan(dto);
    }

    async updatePlan(id: string, dto: Partial<Plan>) {
        return this.plansService.updatePlan(id, dto);
    }

    async deletePlan(id: string) {
        return this.plansService.deletePlan(id);
    }

    async overrideUserSubscription(userId: string, planId: string, durationDays: number) {
        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');
        
        const planEntity = await this.planRepository.findOne({ where: { id: planId } });
        if (!planEntity) throw new NotFoundException('Plan not found');

        // Cancel existing
        await this.subscriptionRepository.update(
            { userId, status: SubscriptionStatus.ACTIVE },
            { status: SubscriptionStatus.CANCELLED },
        );

        const startDate = new Date();
        const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

        const sub = this.subscriptionRepository.create({
            userId,
            plan: planEntity.code,
            planId: planEntity.id,
            planEntity,
            status: SubscriptionStatus.ACTIVE,
            startDate,
            endDate,
            paymentReference: 'ADMIN_OVERRIDE',
            paymentProvider: 'admin',
        });

        const savedSubscription = await this.subscriptionRepository.save(sub);
        await this.subscriptionsService.syncUserPremiumState(userId);
        return savedSubscription;
    }

    // â”€â”€â”€ SUBSCRIPTIONS OVERVIEW â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async getSubscriptions(
        pagination: PaginationDto,
        filters: AdminSubscriptionsFilters = {},
    ) {
        const qb = this.subscriptionRepository
            .createQueryBuilder('subscription')
            .leftJoinAndSelect('subscription.user', 'user')
            .leftJoinAndSelect('subscription.planEntity', 'planEntity')
            .skip(pagination.skip)
            .take(pagination.limit);

        if (filters.plan) {
            qb.andWhere('(planEntity.code = :plan OR subscription.plan = :plan)', { plan: filters.plan });
        }

        if (filters.userId) {
            qb.andWhere('subscription.userId = :userId', { userId: filters.userId });
        }

        if (filters.status) {
            qb.andWhere('subscription.status = :status', { status: filters.status });
        }

        const normalizedSearch = filters.search?.trim();
        if (normalizedSearch) {
            const likeSearch = `%${normalizedSearch}%`;
            qb.andWhere(
                new Brackets((searchQb) => {
                    searchQb
                        .where('subscription.id::text = :exactSearch', { exactSearch: normalizedSearch })
                        .orWhere('subscription.userId::text = :exactSearch', { exactSearch: normalizedSearch })
                        .orWhere('subscription.plan ILIKE :likeSearch', { likeSearch })
                        .orWhere('planEntity.code ILIKE :likeSearch', { likeSearch })
                        .orWhere('planEntity.name ILIKE :likeSearch', { likeSearch })
                        .orWhere('user.email ILIKE :likeSearch', { likeSearch })
                        .orWhere('user.username ILIKE :likeSearch', { likeSearch })
                        .orWhere("CONCAT(user.firstName, ' ', user.lastName) ILIKE :likeSearch", {
                            likeSearch,
                        });
                }),
            );
        }

        if (filters.dateFrom) {
            qb.andWhere('subscription.createdAt >= :dateFrom', { dateFrom: filters.dateFrom });
        }
        if (filters.dateTo) {
            qb.andWhere('subscription.createdAt <= :dateTo', {
                dateTo: this.endOfDay(filters.dateTo),
            });
        }

        const sortColumn = this.resolveSortColumn(
            filters.sortBy,
            AdminService.SUBSCRIPTION_SORT_COLUMNS,
            'subscription.createdAt',
        );
        const sortOrder = this.resolveSortOrder(filters.sortOrder);

        qb.orderBy(sortColumn, sortOrder);

        const [subscriptions, total] = await qb.getManyAndCount();
        const countRows = await this.subscriptionRepository
            .createQueryBuilder('subscription')
            .leftJoin('subscription.planEntity', 'planEntity')
            .select("COALESCE(planEntity.code, subscription.plan, 'free')", 'plan')
            .addSelect('COUNT(*)', 'count')
            .groupBy("COALESCE(planEntity.code, subscription.plan, 'free')")
            .getRawMany();

        const counts = countRows.reduce((acc, row) => {
            acc[row.plan || 'free'] = Number(row.count) || 0;
            return acc;
        }, {} as Record<string, number>);

        return { subscriptions, total, page: pagination.page, limit: pagination.limit, counts };
    }

    async updateUserStatus(
        userId: string,
        status: UserStatus,
        options?: {
            reason?: string;
            moderationReasonCode?: any;
            moderationReasonText?: string;
            actionRequired?: any;
            supportMessage?: string;
            isUserVisible?: boolean;
            expiresAt?: string;
            internalAdminNote?: string;
            updatedByAdminId?: string;
        },
    ): Promise<User | null> {
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: { id: true },
        });
        if (!user) throw new NotFoundException('User not found');

        const updateData: Partial<User> = {
            status,
            statusReason: options?.reason || null,
            moderationReasonCode: options?.moderationReasonCode || null,
            moderationReasonText: options?.moderationReasonText || null,
            actionRequired: options?.actionRequired || null,
            supportMessage: options?.supportMessage || null,
            isUserVisible: options?.isUserVisible !== undefined ? options.isUserVisible : true,
            moderationExpiresAt: options?.expiresAt ? new Date(options.expiresAt) : null,
            internalAdminNote: options?.internalAdminNote || null,
            updatedByAdminId: options?.updatedByAdminId || null,
        };

        // When status is ACTIVE, clear all moderation fields
        if (status === UserStatus.ACTIVE) {
            updateData.statusReason = null;
            updateData.moderationReasonCode = null;
            updateData.moderationReasonText = null;
            updateData.actionRequired = null;
            updateData.supportMessage = null;
            updateData.moderationExpiresAt = null;
            updateData.internalAdminNote = null;
        }

        await this.userRepository.update(userId, updateData);

        // Invalidate cached user status so the guard picks up the new status immediately
        await this.redisService.del(`user_status:${userId}`);

        if (status === UserStatus.BANNED) {
            await this.redisService.invalidateAllUserSessions(userId);
        }

        // When a user is BANNED or CLOSED, clean up all their presence in the system
        if (status === UserStatus.BANNED || status === UserStatus.CLOSED) {
            await this.deactivateUserPresence(userId, status === UserStatus.BANNED ? 'banned' : 'account_closed');
        }

        // Notify the user about their status change
        if (status !== UserStatus.ACTIVE) {
            const actionRequired = options?.actionRequired || this.inferActionRequired(status, options?.moderationReasonCode);
            const targetScreen = this.mapActionRequiredToScreen(actionRequired);
            const userMessage = options?.supportMessage
                || this.buildStatusChangeMessage(status, options?.moderationReasonCode, actionRequired);

            await this.notificationsService.createNotification(userId, {
                type: 'system',
                title: this.getStatusChangeTitle(status),
                body: userMessage,
                data: {
                    newStatus: status,
                    reason: options?.moderationReasonText || options?.reason || null,
                    moderationReasonCode: options?.moderationReasonCode || null,
                    actionRequired,
                    targetScreen,
                    route: '/trust-safety/account-status',
                },
            }).catch((err) => this.logger.warn(`Failed to send status notification: ${err.message}`));
        }

        const updatedUser = await this.userRepository.findOne({ where: { id: userId } });
        return updatedUser ? this.normalizeUserState(updatedUser) : null;
    }

    private inferActionRequired(status: UserStatus, reasonCode?: string): string {
        if (reasonCode === ModerationReasonCode.IDENTITY_VERIFICATION_FAILED) return ActionRequired.REUPLOAD_IDENTITY_DOCUMENT;
        if (reasonCode === ModerationReasonCode.SELFIE_VERIFICATION_FAILED) return ActionRequired.RETAKE_SELFIE;
        if (reasonCode === ModerationReasonCode.MARRIAGE_DOCUMENT_REQUIRED) return ActionRequired.UPLOAD_MARRIAGE_DOCUMENT;
        if (reasonCode === ModerationReasonCode.POLICY_VIOLATION) return ActionRequired.CONTACT_SUPPORT;
        if (status === UserStatus.PENDING_VERIFICATION) return ActionRequired.WAIT_FOR_REVIEW;
        if (status === UserStatus.SUSPENDED || status === UserStatus.LIMITED) return ActionRequired.CONTACT_SUPPORT;
        if (status === UserStatus.BANNED) return ActionRequired.NO_ACTION;
        return ActionRequired.WAIT_FOR_REVIEW;
    }

    private mapActionRequiredToScreen(actionRequired: string): string {
        switch (actionRequired) {
            case ActionRequired.REUPLOAD_IDENTITY_DOCUMENT:
            case ActionRequired.RETAKE_SELFIE:
            case ActionRequired.UPLOAD_MARRIAGE_DOCUMENT:
                return 'verification_center';
            case ActionRequired.CONTACT_SUPPORT:
                return 'support';
            default:
                return 'account_status';
        }
    }

    private getStatusChangeTitle(status: UserStatus): string {
        switch (status) {
            case UserStatus.BANNED: return 'Account banned';
            case UserStatus.SUSPENDED: return 'Account suspended';
            case UserStatus.LIMITED: return 'Account restricted';
            case UserStatus.SHADOW_SUSPENDED: return 'Account under review';
            case UserStatus.PENDING_VERIFICATION: return 'Verification required';
            case UserStatus.REJECTED: return 'Verification rejected';
            case UserStatus.DEACTIVATED: return 'Account deactivated';
            case UserStatus.CLOSED: return 'Account closed';
            default: return 'Account status updated';
        }
    }

    private buildStatusChangeMessage(status: UserStatus, reasonCode?: string, actionRequired?: string): string {
        if (actionRequired === ActionRequired.REUPLOAD_IDENTITY_DOCUMENT
            || actionRequired === ActionRequired.RETAKE_SELFIE
            || actionRequired === ActionRequired.UPLOAD_MARRIAGE_DOCUMENT) {
            return 'Your account requires additional verification. Please visit the verification center to upload the required document.';
        }
        if (actionRequired === ActionRequired.CONTACT_SUPPORT || reasonCode === ModerationReasonCode.POLICY_VIOLATION) {
            return 'Your account has been restricted due to a policy violation. Please review our terms of service and contact support for assistance.';
        }
        if (status === UserStatus.SUSPENDED) {
            return 'Your account has been temporarily suspended. Please contact support for more information.';
        }
        if (status === UserStatus.BANNED) {
            return 'Your account has been banned. If you believe this is an error, please contact support.';
        }
        return 'Your account status has been updated. Please contact support if you have questions.';
    }

    /**
     * When a user is BANNED or CLOSED, remove them from all public visibility:
     * - Close all active matches
     * - Lock all active conversations + insert system message
     * - Invalidate pending likes sent/received
     * - Cancel pending rematch requests
     * - Invalidate caches for all affected users
     */
    private async deactivateUserPresence(userId: string, reason: string): Promise<void> {
        this.logger.log(`Deactivating presence for user ${userId} (reason: ${reason})`);

        const lockReason = reason === 'banned'
            ? 'This conversation is no longer available.'
            : 'This user has closed their account.';

        // 1. Close all active matches involving this user
        const activeMatches = await this.matchRepository.find({
            where: [
                { user1Id: userId, status: MatchStatus.ACTIVE },
                { user2Id: userId, status: MatchStatus.ACTIVE },
            ],
        });
        if (activeMatches.length > 0) {
            for (const match of activeMatches) {
                match.status = MatchStatus.CLOSED;
            }
            await this.matchRepository.save(activeMatches);
            this.logger.log(`Closed ${activeMatches.length} matches for user ${userId}`);
        }

        // 2. Lock all active conversations involving this user + insert system message
        const activeConversations = await this.conversationRepository.find({
            where: [
                { user1Id: userId, isActive: true },
                { user2Id: userId, isActive: true },
            ],
        });
        for (const conv of activeConversations) {
            conv.isActive = false;
            conv.isLocked = true;
            conv.lockReason = lockReason;
            await this.conversationRepository.save(conv);

            // Insert a system message so the other user sees the notice
            const systemMsg = this.messageRepository.create({
                conversationId: conv.id,
                matchId: conv.matchId,
                senderId: userId,
                content: lockReason,
                type: MessageType.SYSTEM,
            });
            await this.messageRepository.save(systemMsg);
        }
        this.logger.log(`Locked ${activeConversations.length} conversations for user ${userId}`);

        // 3. Invalidate pending likes FROM this user (they should not appear in anyone's "who liked me")
        await this.likeRepository.delete({ likerId: userId, isLike: true });

        // 4. Invalidate pending likes RECEIVED by this user (no longer actionable)
        // We keep them in DB for audit but mark them as passes so they don't trigger matches
        await this.likeRepository.update(
            { likedId: userId, isLike: true },
            { isLike: false, type: LikeType.PASS },
        );

        // 5. Cancel pending rematch requests involving this user
        await this.rematchRepository.update(
            { requesterId: userId, status: RematchStatus.PENDING },
            { status: RematchStatus.EXPIRED },
        );
        await this.rematchRepository.update(
            { targetId: userId, status: RematchStatus.PENDING },
            { status: RematchStatus.EXPIRED },
        );

        // 6. Invalidate caches for the banned/closed user AND all their matched users
        const affectedUserIds = new Set<string>([userId]);
        for (const match of activeMatches) {
            affectedUserIds.add(match.user1Id === userId ? match.user2Id : match.user1Id);
        }
        for (const conv of activeConversations) {
            affectedUserIds.add(conv.user1Id === userId ? conv.user2Id : conv.user1Id);
        }

        await Promise.all([...affectedUserIds].flatMap(id => [
            this.redisService.del(`excludeIds:${id}`),
            this.redisService.del(`discovery:${id}`),
            this.redisService.del(`suggestions:${id}`),
            this.redisService.del(`search:${id}:*`),
            this.redisService.del(`matches:${id}`),
            this.redisService.del(`conversations:${id}`),
            this.redisService.del(`premium:${id}`),
            this.redisService.del(`user_status:${id}`),
        ]));

        this.logger.log(`Deactivated presence for user ${userId}: ${activeMatches.length} matches closed, ${activeConversations.length} conversations locked, caches invalidated for ${affectedUserIds.size} users`);
    }

    async searchUsers(query: string, pagination: PaginationDto, filters?: AdminUserFilters) {
        const mergedFilters: AdminUserFilters = { ...(filters || {}) };
        const normalizedQuery = query?.trim();
        if (normalizedQuery) {
            mergedFilters.search = normalizedQuery;
        }
        return this.getUsers(pagination, mergedFilters);
    }

    async getVerifications(pagination: PaginationDto, filters: AdminVerificationFilters = {}) {
        const qb = this.userRepository
            .createQueryBuilder('user')
            .select([...AdminService.ADMIN_USER_QUERY_SELECT_COLUMNS])
            .distinct(true);

        const selfieUrlExpr = `NULLIF(COALESCE(user.verification->'selfie'->>'url', user."selfieUrl"), '')`;
        const identityUrlExpr = `NULLIF(COALESCE(user.verification->'identity'->>'url', user."documentUrl"), '')`;
        const maritalUrlExpr = `NULLIF(user.verification->'marital_status'->>'url', '')`;
        const selfieStatusExpr = `COALESCE(user.verification->'selfie'->>'status', CASE WHEN ${selfieUrlExpr} IS NOT NULL AND user."selfieVerified" = true THEN :approvedStatus WHEN ${selfieUrlExpr} IS NOT NULL THEN :pendingStatus ELSE :fallbackStatus END)`;
        const identityStatusExpr = `COALESCE(user.verification->'identity'->>'status', CASE WHEN ${identityUrlExpr} IS NOT NULL AND user."documentVerified" = true THEN :approvedStatus WHEN user."documentRejectionReason" IS NOT NULL THEN :rejectedStatus WHEN ${identityUrlExpr} IS NOT NULL THEN :pendingStatus ELSE :fallbackStatus END)`;
        const maritalStatusExpr = `COALESCE(user.verification->'marital_status'->>'status', CASE WHEN ${maritalUrlExpr} IS NOT NULL THEN :pendingStatus ELSE :fallbackStatus END)`;

        qb.setParameters({
            pendingStatus: VerificationStatus.PENDING,
            approvedStatus: VerificationStatus.APPROVED,
            rejectedStatus: VerificationStatus.REJECTED,
            fallbackStatus: VerificationStatus.NOT_SUBMITTED,
        });

        const verificationType = filters.type || 'all';
        const verificationStatus = filters.status || 'all';

        if (verificationType === 'selfie') {
            if (verificationStatus === 'pending') {
                qb.andWhere(`${selfieStatusExpr} = :pendingStatus`);
            } else if (verificationStatus === 'approved') {
                qb.andWhere(`${selfieStatusExpr} = :approvedStatus`);
            } else if (verificationStatus === 'rejected') {
                qb.andWhere(`${selfieStatusExpr} = :rejectedStatus`);
            } else {
                qb.andWhere(`${selfieStatusExpr} != :fallbackStatus`);
            }
        } else if (verificationType === 'identity') {
            if (verificationStatus === 'pending') {
                qb.andWhere(`${identityStatusExpr} = :pendingStatus`);
            } else if (verificationStatus === 'approved') {
                qb.andWhere(`${identityStatusExpr} = :approvedStatus`);
            } else if (verificationStatus === 'rejected') {
                qb.andWhere(`${identityStatusExpr} = :rejectedStatus`);
            } else {
                qb.andWhere(`${identityStatusExpr} != :fallbackStatus`);
            }
        } else if (verificationType === 'marital_status') {
            if (verificationStatus === 'pending') {
                qb.andWhere(`${maritalStatusExpr} = :pendingStatus`);
            } else if (verificationStatus === 'approved') {
                qb.andWhere(`${maritalStatusExpr} = :approvedStatus`);
            } else if (verificationStatus === 'rejected') {
                qb.andWhere(`${maritalStatusExpr} = :rejectedStatus`);
            } else {
                qb.andWhere(`${maritalStatusExpr} != :fallbackStatus`);
            }
        } else {
            if (verificationStatus === 'pending') {
                qb.andWhere(`(${selfieStatusExpr} = :pendingStatus OR ${identityStatusExpr} = :pendingStatus OR ${maritalStatusExpr} = :pendingStatus)`);
            } else if (verificationStatus === 'approved') {
                qb.andWhere(`(${selfieStatusExpr} = :approvedStatus OR ${identityStatusExpr} = :approvedStatus OR ${maritalStatusExpr} = :approvedStatus)`);
            } else if (verificationStatus === 'rejected') {
                qb.andWhere(`(${selfieStatusExpr} = :rejectedStatus OR ${identityStatusExpr} = :rejectedStatus OR ${maritalStatusExpr} = :rejectedStatus)`);
            } else {
                qb.andWhere(`(${selfieStatusExpr} != :fallbackStatus OR ${identityStatusExpr} != :fallbackStatus OR ${maritalStatusExpr} != :fallbackStatus)`);
            }
        }

        if (filters.userStatus) {
            qb.andWhere('user.status = :userStatus', { userStatus: filters.userStatus });
        }

        const normalizedSearch = filters.search?.trim();
        if (normalizedSearch) {
            const likeSearch = `%${normalizedSearch}%`;
            qb.andWhere(
                new Brackets((searchQb) => {
                    searchQb
                        .where('user.id::text = :exactSearch', { exactSearch: normalizedSearch })
                        .orWhere('user.firstName ILIKE :likeSearch', { likeSearch })
                        .orWhere('user.lastName ILIKE :likeSearch', { likeSearch })
                        .orWhere("CONCAT(user.firstName, ' ', user.lastName) ILIKE :likeSearch", {
                            likeSearch,
                        })
                        .orWhere('user.email ILIKE :likeSearch', { likeSearch })
                        .orWhere('user.username ILIKE :likeSearch', { likeSearch });
                }),
            );
        }

        if (filters.dateFrom) {
            qb.andWhere('user.updatedAt >= :dateFrom', { dateFrom: filters.dateFrom });
        }
        if (filters.dateTo) {
            qb.andWhere('user.updatedAt <= :dateTo', { dateTo: this.endOfDay(filters.dateTo) });
        }

        const sortColumn = this.resolveSortColumn(
            filters.sortBy,
            AdminService.VERIFICATION_SORT_COLUMNS,
            'user.createdAt',
        );
        const sortOrder = this.resolveSortOrder(filters.sortOrder);

        qb.orderBy(sortColumn, sortOrder)
            .skip(pagination.skip)
            .take(pagination.limit);

        const [users, total] = await qb.getManyAndCount();
        const normalizedUsers = users.map((user) => this.normalizeUserState(user));

        return {
            users: normalizedUsers,
            items: normalizedUsers,
            total,
            page: pagination.page,
            limit: pagination.limit,
        };
    }

    async getPendingVerifications() {
        const pagination = new PaginationDto();
        const result = await this.getVerifications(pagination, { status: 'pending' });
        return result.users;
    }

    async getAdminNotifications(
        pagination: PaginationDto,
        filters: AdminNotificationsFilters = {},
    ) {
        const qb = this.notificationRepository
            .createQueryBuilder('notification')
            .leftJoinAndSelect('notification.user', 'user');

        if (filters.userId) {
            qb.andWhere('notification.userId = :userId', { userId: filters.userId });
        }
        if (filters.type) {
            qb.andWhere('notification.type = :type', { type: filters.type });
        }
        if (typeof filters.isRead === 'boolean') {
            qb.andWhere('notification.isRead = :isRead', { isRead: filters.isRead });
        }

        const normalizedSearch = filters.search?.trim();
        if (normalizedSearch) {
            const likeSearch = `%${normalizedSearch}%`;
            qb.andWhere(
                new Brackets((searchQb) => {
                    searchQb
                        .where('notification.id::text = :exactSearch', { exactSearch: normalizedSearch })
                        .orWhere('notification.title ILIKE :likeSearch', { likeSearch })
                        .orWhere('notification.body ILIKE :likeSearch', { likeSearch })
                        .orWhere('user.id::text = :exactSearch', { exactSearch: normalizedSearch })
                        .orWhere('user.email ILIKE :likeSearch', { likeSearch })
                        .orWhere('user.username ILIKE :likeSearch', { likeSearch })
                        .orWhere('user.firstName ILIKE :likeSearch', { likeSearch })
                        .orWhere('user.lastName ILIKE :likeSearch', { likeSearch })
                        .orWhere("CONCAT(user.firstName, ' ', user.lastName) ILIKE :likeSearch", {
                            likeSearch,
                        });
                }),
            );
        }

        if (filters.dateFrom) {
            qb.andWhere('notification.createdAt >= :dateFrom', { dateFrom: filters.dateFrom });
        }
        if (filters.dateTo) {
            qb.andWhere('notification.createdAt <= :dateTo', { dateTo: this.endOfDay(filters.dateTo) });
        }

        const sortColumn = this.resolveSortColumn(
            filters.sortBy,
            AdminService.NOTIFICATION_SORT_COLUMNS,
            'notification.createdAt',
        );
        const sortOrder = this.resolveSortOrder(filters.sortOrder);

        qb.orderBy(sortColumn, sortOrder)
            .skip(pagination.skip)
            .take(pagination.limit);

        const [notifications, total] = await qb.getManyAndCount();
        return {
            notifications: notifications.map((notification) =>
                this.serializeAdminNotification(notification),
            ),
            total,
            page: pagination.page,
            limit: pagination.limit,
        };
    }

    async getUserActions(userId: string, pagination: PaginationDto) {
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: { id: true, email: true },
        });
        if (!user) {
            throw new NotFoundException('User not found');
        }

        const [adminLogs, loginLogs] = await Promise.all([
            this.redisService.getAuditLogs('admin', 5000),
            this.redisService.getAuditLogs('login', 5000),
        ]);

        const normalizedEmail = (user.email || '').toLowerCase();
        const actionEntries = [...adminLogs, ...loginLogs]
            .filter((entry: any) => {
                if (!entry || typeof entry !== 'object') return false;
                const entryEmail = String(entry.email || '').toLowerCase();
                return (
                    entry.targetUserId === userId ||
                    entry.userId === userId ||
                    (normalizedEmail && entryEmail === normalizedEmail)
                );
            })
            .sort((a: any, b: any) => {
                const aTime = new Date(a.timestamp || 0).getTime();
                const bTime = new Date(b.timestamp || 0).getTime();
                return bTime - aTime;
            });

        const actorIds = [...new Set(
            actionEntries.flatMap((entry: any) => [entry.adminId, entry.userId].filter(Boolean)),
        )];
        const actorMap = new Map<string, Partial<User>>();

        if (actorIds.length > 0) {
            const actors = await this.userRepository.find({
                where: actorIds.map((id) => ({ id })),
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    role: true,
                },
            });
            actors.forEach((actor) => actorMap.set(actor.id, actor));
        }

        const actions = actionEntries.map((entry: any, index: number) => ({
                id: `${entry.type || 'audit'}-${entry.action || 'event'}-${index}`,
                type: entry.type || 'audit',
                action: entry.action || 'event',
                timestamp: entry.timestamp || null,
                adminId: entry.adminId || null,
                actorUserId: entry.userId || null,
                targetUserId: entry.targetUserId || entry.userId || userId,
                admin: entry.adminId ? actorMap.get(entry.adminId) || null : null,
                actor: entry.userId ? actorMap.get(entry.userId) || null : null,
                details: entry,
            }));

        const limit = pagination.limit ?? 20;

        return {
            actions: actions.slice(pagination.skip, pagination.skip + limit),
            total: actions.length,
            page: pagination.page,
            limit,
        };
    }

    async setUserPremium(userId: string, startDate: Date, expiryDate: Date) {
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: { id: true, email: true },
        });
        if (!user) throw new NotFoundException('User not found');

        const subscription = await this.subscriptionsService.setManualPremium(
            userId,
            startDate,
            expiryDate,
        );

        await this.notificationsService.sendSubscriptionNotification(
            userId,
            'Premium activated',
            'Your premium subscription has been activated by the Methna team.',
            {
                premiumStartDate: startDate.toISOString(),
                premiumExpiryDate: expiryDate.toISOString(),
            },
        );

        const updatedUser = await this.userRepository.findOne({
            where: { id: userId },
            select: AdminService.ADMIN_USER_SELECT,
        });

        return {
            user: updatedUser ? this.normalizeUserState(updatedUser) : null,
            subscription,
        };
    }

    async removeUserPremium(userId: string) {
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: { id: true, email: true },
        });
        if (!user) throw new NotFoundException('User not found');

        await this.subscriptionsService.removePremium(userId);

        await this.notificationsService.sendSubscriptionNotification(
            userId,
            'Premium removed',
            'Your premium subscription has been removed by the Methna team.',
            {},
        );

        const updatedUser = await this.userRepository.findOne({
            where: { id: userId },
            select: AdminService.ADMIN_USER_SELECT,
        });
        return updatedUser ? this.normalizeUserState(updatedUser) : null;
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

    async deleteUserAccount(userId: string): Promise<void> {
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: { id: true },
        });
        if (!user) throw new NotFoundException('User not found');

        // Soft delete the user (uses @DeleteDateColumn)
        await this.userRepository.softDelete(userId);
        this.logger.warn(`Admin deleted user account: ${userId}`);
    }

    async permanentlyDeleteUsers(
        userIds: string[],
        options: { actingAdminId?: string } = {},
    ): Promise<{
        requestedCount: number;
        deletedCount: number;
        deletedUserIds: string[];
        skippedUserIds: string[];
        protectedUserIds: string[];
    }> {
        const requestedUserIds = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];

        if (!requestedUserIds.length) {
            throw new BadRequestException('At least one user id is required');
        }

        const protectedUserIds =
            options.actingAdminId && requestedUserIds.includes(options.actingAdminId)
                ? [options.actingAdminId]
                : [];

        const deleteCandidateIds = requestedUserIds.filter(
            (id) => !protectedUserIds.includes(id),
        );

        if (!deleteCandidateIds.length) {
            throw new BadRequestException('Cannot permanently delete the active admin account');
        }

        const existingUsers = await this.userRepository.find({
            where: { id: In(deleteCandidateIds) },
            select: { id: true },
        });

        const deletedUserIds = existingUsers.map((user) => user.id);

        if (deletedUserIds.length) {
            await this.userRepository.delete(deletedUserIds);

            await Promise.all(
                deletedUserIds.flatMap((id) => [
                    this.redisService.invalidateAllUserSessions(id),
                    this.redisService.del(`user_status:${id}`),
                    this.redisService.del(`excludeIds:${id}`),
                    this.redisService.del(`likes_sent_today:${id}`),
                    this.redisService.del(`super_likes_sent_today:${id}`),
                    this.redisService.del(`compliments_sent_today:${id}`),
                    this.redisService.del(`compliments_received_today:${id}`),
                    this.redisService.del(`passport_uses_today:${id}`),
                    this.redisService.del(`rewinds_remaining:${id}`),
                    this.redisService.del(`boosts_remaining:${id}`),
                    this.redisService.del(`plan:${id}`),
                    this.redisService.del(`features:${id}`),
                    this.redisService.del(`entitlements:${id}`),
                ]),
            );
        }

        return {
            requestedCount: requestedUserIds.length,
            deletedCount: deletedUserIds.length,
            deletedUserIds,
            skippedUserIds: requestedUserIds.filter(
                (id) => !deletedUserIds.includes(id) && !protectedUserIds.includes(id),
            ),
            protectedUserIds,
        };
    }

    // â”€â”€â”€ REPORTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    // â”€â”€â”€ PHOTO MODERATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    // â”€â”€â”€ ANALYTICS / DASHBOARD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async getDashboardStats() {
        const [
            totalUsers,
            activeUsers,
            rejectedUsers,
            suspendedUsers,
            bannedUsers,
            pendingVerification,
            totalProfiles,
            totalMatches,
            pendingReports,
            resolvedReports,
            premiumUsers,
            totalPhotos,
            pendingPhotos,
            totalMessages,
            totalLikes,
            totalCompliments,
            totalPasses,
            totalBoosts,
            totalConversations,
            totalBlocks,
        ] = await Promise.all([
            this.userRepository.count(),
            this.userRepository.count({ where: { status: UserStatus.ACTIVE } }),
            this.userRepository.count({ where: { status: UserStatus.REJECTED } }),
            this.userRepository.count({ where: { status: UserStatus.SUSPENDED } }),
            this.userRepository.count({ where: { status: UserStatus.BANNED } }),
            this.userRepository.count({ where: { status: UserStatus.PENDING_VERIFICATION } }),
            this.profileRepository.count(),
            this.matchRepository.count(),
            this.reportRepository.count({ where: { status: ReportStatus.PENDING } }),
            this.reportRepository.count({ where: { status: ReportStatus.RESOLVED } }),
            this.subscriptionRepository
                .createQueryBuilder('subscription')
                .leftJoin('subscription.planEntity', 'planEntity')
                .where('subscription.status IN (:...statuses)', {
                    statuses: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
                })
                .andWhere("COALESCE(planEntity.code, subscription.plan, 'free') != :freePlan", {
                    freePlan: 'free',
                })
                .select('COUNT(DISTINCT subscription.userId)', 'count')
                .getRawOne()
                .then((row) => Number(row?.count) || 0),
            this.photoRepository.count(),
            this.photoRepository.count({ where: { moderationStatus: PhotoModerationStatus.PENDING } }),
            this.messageRepository.count(),
            this.likeRepository.count({ where: { type: LikeType.LIKE } }),
            this.likeRepository.count({ where: { type: LikeType.COMPLIMENT } }),
            this.likeRepository.count({ where: { type: LikeType.PASS } }),
            this.boostRepository.count(),
            this.conversationRepository.count(),
            this.blockedUserRepository.count(),
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
                rejected: rejectedUsers,
                suspended: suspendedUsers,
                banned: bannedUsers,
                pendingVerification,
                newThisWeek: newUsersThisWeek,
                newThisMonth: newUsersThisMonth,
            },
            content: {
                totalProfiles,
                totalMatches,
                totalPhotos,
                pendingPhotos,
                totalMessages,
                totalConversations,
            },
            swipes: {
                totalLikes,
                totalCompliments,
                totalPasses,
            },
            engagement: {
                totalBoosts,
                totalBlocks,
            },
            reports: {
                pending: pendingReports,
                resolved: resolvedReports,
            },
            revenue: {
                premiumUsers,
                conversionRate: totalUsers > 0
                    ? ((premiumUsers / totalUsers) * 100).toFixed(2) + '%'
                    : '0%',
            },
        };
    }

    private normalizeUserState(user: User): User {
        const hasActivePremium = this.hasActivePremiumEntitlement(user);
        const verification = this.reconcileVerificationState(user);

        return {
            ...user,
            isPremium: hasActivePremium,
            premiumStartDate: user.premiumStartDate ?? null,
            premiumExpiryDate: user.premiumExpiryDate ?? null,
            verification,
        };
    }

    private buildNotificationPayload(
        type: string,
        userId: string,
        conversationId?: string | null,
        extraData: Record<string, any> = {},
    ) {
        return {
            payload: {
                type,
                userId,
                conversationId: conversationId ?? null,
                extraData,
            },
        };
    }

    private serializeAdminNotification(notification: Notification & { user?: User }) {
        const rawData = notification?.data ?? {};
        const payload =
            rawData && typeof rawData.payload === 'object' && rawData.payload
                ? rawData.payload
                : rawData;
        const extraData =
            payload && typeof payload.extraData === 'object' && payload.extraData
                ? payload.extraData
                : {};
        const normalizedType =
            typeof payload?.type === 'string' && payload.type.trim().length > 0
                ? payload.type.trim().toLowerCase()
                : notification.type;

        return {
            ...notification,
            type: normalizedType,
            deliveredAt: notification.createdAt ?? null,
            route:
                extraData.route ||
                extraData.deepLink ||
                rawData.route ||
                null,
            targetScreen:
                extraData.targetScreen ||
                rawData.targetScreen ||
                null,
            entityId:
                extraData.entityId ??
                extraData.ticketId ??
                extraData.matchId ??
                payload?.conversationId ??
                payload?.userId ??
                null,
            payload,
        };
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
                verification: true,
                selfieUrl: true,
                selfieVerified: true,
                documentUrl: true,
                documentVerified: true,
                documentVerifiedAt: true,
                documentRejectionReason: true,
            },
        });
        if (!user) throw new NotFoundException('User not found');

        const verification = normalizeVerificationState(user.verification);
        const existing = verification[field];
        const now = new Date().toISOString();
        let url = existing.url || null;

        if (!url && field === 'selfie') {
            url = user.selfieUrl || null;
        }

        if (!url && field === 'marital_status') {
            url =
                user.documentUrl ||
                (await this.redisService.get(`marriage_cert:${userId}`)) ||
                null;
        }

        if (status !== VerificationStatus.NOT_SUBMITTED && !url) {
            throw new BadRequestException(
                field === 'selfie'
                    ? 'User has not uploaded a selfie'
                    : 'User has not uploaded a marital-status document',
            );
        }

        verification[field] = {
            ...existing,
            status,
            url: status === VerificationStatus.NOT_SUBMITTED ? null : url,
            submittedAt:
                status === VerificationStatus.NOT_SUBMITTED
                    ? null
                    : existing.submittedAt || now,
            reviewedAt:
                status === VerificationStatus.PENDING || status === VerificationStatus.NOT_SUBMITTED
                    ? null
                    : now,
            reviewedBy:
                status === VerificationStatus.PENDING || status === VerificationStatus.NOT_SUBMITTED
                    ? null
                    : adminId,
            rejectionReason:
                status === VerificationStatus.REJECTED
                    ? rejectionReason || 'Verification rejected'
                    : null,
        };

        if (field === 'selfie') {
            (user as any).selfieUrl = verification.selfie.url;
            user.selfieVerified = status === VerificationStatus.APPROVED;
        }

        if (field === 'marital_status') {
            (user as any).documentUrl = verification.marital_status.url;
            user.documentVerified = status === VerificationStatus.APPROVED;
            user.documentVerifiedAt = status === VerificationStatus.APPROVED ? new Date(now) : null;
            (user as any).documentRejectionReason =
                status === VerificationStatus.REJECTED
                    ? rejectionReason || 'Verification rejected'
                    : null;
        }

        user.verification = verification;
        const savedUser = await this.userRepository.save(user);

        const redisKey =
            field === 'selfie'
                ? `selfie_status:${userId}`
                : `marriage_cert_status:${userId}`;
        await this.redisService.set(redisKey, this.mapVerificationStatusToRedis(status), 0);

        await this.notificationsService.createNotification(userId, {
            type: 'verification',
            title:
                field === 'selfie'
                    ? 'Selfie verification updated'
                    : 'Marital status verification updated',
            body:
                status === VerificationStatus.APPROVED
                    ? 'Your verification has been approved.'
                    : status === VerificationStatus.REJECTED
                        ? (field === 'selfie'
                            ? rejectionReason || 'Your selfie verification was rejected. Please retake a clear live selfie photo.'
                            : rejectionReason || 'Your verification was rejected.')
                        : 'Your verification is pending review.',
            data: {
                verificationType: field,
                status,
                rejectionReason: status === VerificationStatus.REJECTED ? rejectionReason || null : null,
                route: '/trust-safety/verification-status',
                targetScreen: 'verification_center',
            },
        });

        return this.normalizeUserState(savedUser);
    }

    private mapVerificationStatusToRedis(status: VerificationStatus): string {
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

    async getUserSubscriptionHistory(userId: string) {
        const subscriptions = await this.subscriptionRepository.find({
            where: { userId },
            relations: ['planEntity'],
            order: { createdAt: 'DESC' },
        });
        return {
            subscriptions: subscriptions.map(s => ({
                id: s.id,
                userId: s.userId,
                planId: s.planId,
                planCode: s.planEntity?.code || s.plan || 'free',
                planName: s.planEntity?.name || s.plan || 'Free',
                billingCycle: s.planEntity?.billingCycle || s.billingCycle || 'monthly',
                status: s.status,
                startDate: s.startDate,
                endDate: s.endDate,
                stripeSubscriptionId: s.stripeSubscriptionId || null,
                stripePriceId: s.planEntity?.stripePriceId || null,
                createdAt: s.createdAt,
            })),
        };
    }

    private normalizeUserFilters(
        statusOrFilters?: UserStatus | AdminUserFilters,
        search?: string,
        role?: UserRole | string,
        plan?: string,
    ): AdminUserFilters {
        if (statusOrFilters && typeof statusOrFilters === 'object') {
            return {
                ...statusOrFilters,
                role: this.normalizeUserRole(statusOrFilters.role),
            };
        }

        return {
            status: statusOrFilters as UserStatus | undefined,
            search,
            role: this.normalizeUserRole(role),
            plan,
        };
    }

    private reconcileVerificationState(user: User) {
        const verification = normalizeVerificationState(user.verification);
        const selfieUrl = (user.selfieUrl || verification.selfie.url || null) as string | null;
        const identityUrl = (user.documentUrl || verification.identity.url || null) as string | null;
        const maritalUrl = (verification.marital_status.url || null) as string | null;

        if (user.selfieVerified === true) {
            verification.selfie = {
                ...verification.selfie,
                status: VerificationStatus.APPROVED,
                url: selfieUrl,
                rejectionReason: null,
            };
        } else if (verification.selfie.status === VerificationStatus.REJECTED) {
            verification.selfie = {
                ...verification.selfie,
                url: selfieUrl,
            };
        } else if (selfieUrl) {
            verification.selfie = {
                ...verification.selfie,
                status: VerificationStatus.PENDING,
                url: selfieUrl,
            };
        } else {
            verification.selfie = {
                ...verification.selfie,
                status: VerificationStatus.NOT_SUBMITTED,
                url: null,
                rejectionReason: null,
                submittedAt: null,
                reviewedAt: null,
                reviewedBy: null,
            };
        }

        if (user.documentVerified === true) {
            verification.identity = {
                ...verification.identity,
                status: VerificationStatus.APPROVED,
                url: identityUrl,
                rejectionReason: null,
                reviewedAt:
                    user.documentVerifiedAt?.toISOString() ||
                    verification.identity.reviewedAt,
            };
        } else if (
            verification.identity.status === VerificationStatus.REJECTED ||
            !!user.documentRejectionReason
        ) {
            verification.identity = {
                ...verification.identity,
                status: VerificationStatus.REJECTED,
                url: identityUrl,
                rejectionReason:
                    verification.identity.rejectionReason ||
                    user.documentRejectionReason ||
                    null,
            };
        } else if (identityUrl) {
            verification.identity = {
                ...verification.identity,
                status: VerificationStatus.PENDING,
                url: identityUrl,
            };
        } else {
            verification.identity = {
                ...verification.identity,
                status: VerificationStatus.NOT_SUBMITTED,
                url: null,
                rejectionReason: null,
                submittedAt: null,
                reviewedAt: null,
                reviewedBy: null,
            };
        }

        if (verification.marital_status.status === VerificationStatus.REJECTED) {
            verification.marital_status = {
                ...verification.marital_status,
                url: maritalUrl,
            };
        } else if (verification.marital_status.status === VerificationStatus.APPROVED) {
            verification.marital_status = {
                ...verification.marital_status,
                url: maritalUrl,
                rejectionReason: null,
            };
        } else if (maritalUrl) {
            verification.marital_status = {
                ...verification.marital_status,
                status: VerificationStatus.PENDING,
                url: maritalUrl,
            };
        } else {
            verification.marital_status = {
                ...verification.marital_status,
                status: VerificationStatus.NOT_SUBMITTED,
                url: null,
                rejectionReason: null,
                submittedAt: null,
                reviewedAt: null,
                reviewedBy: null,
            };
        }

        return verification;
    }

    private hasActivePremiumEntitlement(
        user:
            | Pick<User, 'isPremium' | 'premiumStartDate' | 'premiumExpiryDate'>
            | null
            | undefined,
    ): boolean {
        if (!user || user.isPremium !== true) {
            return false;
        }

        const now = Date.now();
        const premiumStartDate = user.premiumStartDate
            ? new Date(user.premiumStartDate).getTime()
            : null;
        const premiumExpiryDate = user.premiumExpiryDate
            ? new Date(user.premiumExpiryDate).getTime()
            : null;

        if (premiumStartDate !== null && Number.isFinite(premiumStartDate) && premiumStartDate > now) {
            return false;
        }

        if (premiumExpiryDate !== null && Number.isFinite(premiumExpiryDate) && premiumExpiryDate <= now) {
            return false;
        }

        return true;
    }

    private normalizeUserRole(value?: UserRole | string | null): UserRole | undefined {
        if (!value) {
            return undefined;
        }

        const normalized = value.toString().trim().toLowerCase();
        if (normalized === 'staff') {
            return UserRole.MODERATOR;
        }
        if (Object.values(UserRole).includes(normalized as UserRole)) {
            return normalized as UserRole;
        }

        return undefined;
    }

    private parseDateInput(value: unknown, fallback: Date | null): Date | null {
        if (value === undefined) {
            return fallback;
        }
        if (value === null || value === '') {
            return null;
        }

        const date = value instanceof Date ? value : new Date(String(value));
        if (Number.isNaN(date.getTime())) {
            throw new BadRequestException('Invalid date value');
        }

        return date;
    }

    private resolveSortColumn(
        sortBy: string | undefined,
        mapping: Record<string, string>,
        fallback: string,
    ): string {
        if (!sortBy) return fallback;
        return mapping[sortBy] || fallback;
    }

    private resolveSortOrder(order?: string): 'ASC' | 'DESC' {
        return (order || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    }

    private endOfDay(date: Date): Date {
        const end = new Date(date);
        end.setHours(23, 59, 59, 999);
        return end;
    }

    private parseBoolean(value: unknown): boolean | undefined {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (normalized === 'true' || normalized === '1') return true;
            if (normalized === 'false' || normalized === '0') return false;
        }
        return undefined;
    }
}


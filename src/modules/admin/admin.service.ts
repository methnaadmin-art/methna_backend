import { Injectable, NotFoundException, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, Not, IsNull } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole, UserStatus } from '../../database/entities/user.entity';
import { Report, ReportStatus } from '../../database/entities/report.entity';
import { Profile } from '../../database/entities/profile.entity';
import { Match } from '../../database/entities/match.entity';
import { Subscription, SubscriptionPlan, SubscriptionStatus } from '../../database/entities/subscription.entity';
import { Photo, PhotoModerationStatus } from '../../database/entities/photo.entity';
import { Like, LikeType } from '../../database/entities/like.entity';
import { Message } from '../../database/entities/message.entity';
import { Boost } from '../../database/entities/boost.entity';
import { Notification, NotificationType } from '../../database/entities/notification.entity';
import { Conversation } from '../../database/entities/conversation.entity';
import { SupportTicket, TicketStatus } from '../../database/entities/support-ticket.entity';
import { Ad } from '../../database/entities/ad.entity';
import { BlockedUser } from '../../database/entities/blocked-user.entity';
import { Plan } from '../../database/entities/plan.entity';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class AdminService implements OnModuleInit {
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
        private readonly redisService: RedisService,
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

    async getUsers(pagination: PaginationDto, status?: UserStatus, search?: string, role?: UserRole, plan?: string) {
        const qb = this.userRepository.createQueryBuilder('user');

        if (status) qb.andWhere('user.status = :status', { status });
        if (role) qb.andWhere('user.role = :role', { role });
        if (search) {
            qb.andWhere(
                '(user.firstName ILIKE :search OR user.lastName ILIKE :search OR user.email ILIKE :search OR user.username ILIKE :search)',
                { search: `%${search}%` },
            );
        }
        if (plan) {
            qb.innerJoin('subscriptions', 'sub', 'sub.userId = user.id AND sub.plan = :plan AND sub.status = :subStatus', { plan, subStatus: 'active' });
        }

        qb.orderBy('user.createdAt', 'DESC')
            .skip(pagination.skip)
            .take(pagination.limit);

        const [users, total] = await qb.getManyAndCount();
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

    // â”€â”€â”€ DOCUMENT VERIFICATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async getPendingDocuments() {
        return this.userRepository.find({
            where: {
                documentUrl: Not(IsNull()),
                documentVerified: false,
                documentRejectionReason: IsNull(),
            },
            order: { createdAt: 'DESC' },
        });
    }

    async verifyDocument(userId: string, approved: boolean, rejectionReason?: string) {
        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');
        if (!user.documentUrl) throw new BadRequestException('User has no document uploaded');

        const reverifyMessage =
            rejectionReason ||
            "Please upload a clearer passport, national ID, or driver's license.";

        user.documentVerified = approved;
        user.documentVerifiedAt = approved ? new Date() : null;
        (user as any).documentRejectionReason = approved
            ? null
            : reverifyMessage;

        if (approved && user.status === UserStatus.PENDING_VERIFICATION) {
            user.status = UserStatus.ACTIVE;
        }

        const savedUser = await this.userRepository.save(user);
        await this.redisService.set(
            `id_doc_status:${userId}`,
            approved ? 'verified' : 'reverify_required',
            0,
        );

        await this.notificationRepository.save(
            this.notificationRepository.create({
                userId,
                type: NotificationType.VERIFICATION,
                title: approved ? 'Identity verified' : 'Reverify your identity',
                body: approved
                    ? 'Your identity document has been approved by the Methna team.'
                    : reverifyMessage,
                data: {
                    status: approved ? 'verified' : 'reverify_required',
                    documentType: user.documentType ?? null,
                    rejectionReason: approved ? null : reverifyMessage,
                },
            }),
        );

        this.logger.log(`Admin ${approved ? 'approved' : 'requested reverify for'} identity document of user ${userId}`);
        return savedUser;
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
            user.documentVerified = true;
            user.documentVerifiedAt = new Date();
            (user as any).documentRejectionReason = null;
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
        role?: UserRole; status?: UserStatus;
    }) {
        const exists = await this.userRepository.findOne({ where: { email: dto.email } });
        if (exists) throw new BadRequestException('Email already exists');

        const salt = await bcrypt.genSalt(12);
        const hashedPassword = await bcrypt.hash(dto.password, salt);

        const user = this.userRepository.create({
            email: dto.email,
            password: hashedPassword,
            firstName: dto.firstName,
            lastName: dto.lastName,
            role: dto.role || UserRole.USER,
            status: dto.status || UserStatus.ACTIVE,
            emailVerified: true,
            trustScore: 100,
            notificationsEnabled: true,
            matchNotifications: true,
            messageNotifications: true,
            likeNotifications: true,
        });

        await this.userRepository.save(user);
        this.logger.log(`Admin created user: ${dto.email}`);
        return user;
    }

    // â”€â”€â”€ UPDATE USER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async updateUser(userId: string, dto: Partial<User>) {
        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');

        delete (dto as any).password;
        delete (dto as any).id;
        Object.assign(user, dto);
        return this.userRepository.save(user);
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

    async getConversations(pagination: PaginationDto) {
        const [conversations, total] = await this.conversationRepository.findAndCount({
            relations: ['user1', 'user2'],
            order: { lastMessageAt: 'DESC' },
            skip: pagination.skip,
            take: pagination.limit,
        });
        return { conversations, total, page: pagination.page, limit: pagination.limit };
    }

    async getConversationMessages(conversationId: string, pagination: PaginationDto) {
        const [messages, total] = await this.messageRepository.findAndCount({
            where: { conversationId },
            relations: ['sender'],
            order: { createdAt: 'ASC' },
            skip: pagination.skip,
            take: pagination.limit,
        });
        return { messages, total, page: pagination.page, limit: pagination.limit };
    }

    // â”€â”€â”€ SEND NOTIFICATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async sendNotification(dto: {
        userId?: string; title: string; body: string; type?: string; broadcast?: boolean;
    }) {
        if (dto.broadcast) {
            const users = await this.userRepository.find({
                where: { status: UserStatus.ACTIVE },
                select: ['id'],
            });
            const notifications = users.map(u =>
                this.notificationRepository.create({
                    userId: u.id,
                    type: (dto.type as NotificationType) || NotificationType.SYSTEM,
                    title: dto.title,
                    body: dto.body,
                }),
            );
            await this.notificationRepository.save(notifications);
            return { sent: notifications.length, broadcast: true };
        }

        if (!dto.userId) throw new BadRequestException('userId required for non-broadcast');
        const notif = this.notificationRepository.create({
            userId: dto.userId,
            type: (dto.type as NotificationType) || NotificationType.SYSTEM,
            title: dto.title,
            body: dto.body,
        });
        await this.notificationRepository.save(notif);
        return { sent: 1, notification: notif };
    }

    // â”€â”€â”€ SUPPORT TICKETS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async getTickets(pagination: PaginationDto, status?: TicketStatus) {
        const where: any = {};
        if (status) where.status = status;

        const [tickets, total] = await this.ticketRepository.findAndCount({
            where,
            relations: ['user', 'assignedTo'],
            order: { createdAt: 'DESC' },
            skip: pagination.skip,
            take: pagination.limit,
        });
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
        await this.notificationRepository.save(
            this.notificationRepository.create({
                userId: ticket.userId,
                type: NotificationType.SYSTEM,
                title: 'Support Reply',
                body: `Your ticket "${ticket.subject}" has been answered.`,
            }),
        );

        return ticket;
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
        return this.adRepository.save(ad);
    }

    async updateAd(id: string, dto: Partial<Ad>) {
        const ad = await this.adRepository.findOne({ where: { id } });
        if (!ad) throw new NotFoundException('Ad not found');
        Object.assign(ad, dto);
        return this.adRepository.save(ad);
    }

    async deleteAd(id: string) {
        const res = await this.adRepository.delete(id);
        if (res.affected === 0) throw new NotFoundException('Ad not found');
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
        return this.planRepository.find({ order: { createdAt: 'ASC' } });
    }

    async createPlan(dto: Partial<Plan>) {
        const plan = this.planRepository.create(dto);
        return this.planRepository.save(plan);
    }

    async updatePlan(id: string, dto: Partial<Plan>) {
        const plan = await this.planRepository.findOne({ where: { id } });
        if (!plan) throw new NotFoundException('Plan not found');
        Object.assign(plan, dto);
        return this.planRepository.save(plan);
    }

    async deletePlan(id: string) {
        const res = await this.planRepository.delete(id);
        if (res.affected === 0) throw new NotFoundException('Plan not found');
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
            planId: planEntity.id,
            planEntity,
            status: SubscriptionStatus.ACTIVE,
            startDate,
            endDate,
            paymentReference: 'ADMIN_OVERRIDE',
        });

        return this.subscriptionRepository.save(sub);
    }

    // â”€â”€â”€ SUBSCRIPTIONS OVERVIEW â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async getSubscriptions(pagination: PaginationDto, plan?: string) {
        const where: any = {};
        if (plan) where.plan = plan;

        const [subscriptions, total] = await this.subscriptionRepository.findAndCount({
            where,
            relations: ['user'],
            order: { createdAt: 'DESC' },
            skip: pagination.skip,
            take: pagination.limit,
        });

        const [freeCount, premiumCount, goldCount] = await Promise.all([
            this.subscriptionRepository.count({ where: { plan: SubscriptionPlan.FREE } }),
            this.subscriptionRepository.count({ where: { plan: SubscriptionPlan.PREMIUM } }),
            this.subscriptionRepository.count({ where: { plan: SubscriptionPlan.GOLD } }),
        ]);

        return { subscriptions, total, page: pagination.page, limit: pagination.limit, counts: { free: freeCount, premium: premiumCount, gold: goldCount } };
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
            this.userRepository.count({ where: { status: UserStatus.SUSPENDED } }),
            this.userRepository.count({ where: { status: UserStatus.BANNED } }),
            this.userRepository.count({ where: { status: UserStatus.PENDING_VERIFICATION } }),
            this.profileRepository.count(),
            this.matchRepository.count(),
            this.reportRepository.count({ where: { status: ReportStatus.PENDING } }),
            this.reportRepository.count({ where: { status: ReportStatus.RESOLVED } }),
            this.subscriptionRepository.count({
                where: [
                    { plan: SubscriptionPlan.PREMIUM, status: 'active' as any },
                    { plan: SubscriptionPlan.GOLD, status: 'active' as any },
                ],
            }),
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
}







import { Injectable, NotFoundException, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, Not, IsNull } from 'typeorm';
import * as bcrypt from 'bcrypt';
import {
    User,
    UserRole,
    UserStatus,
    VerificationStatus,
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
import { SupportTicket, TicketStatus } from '../../database/entities/support-ticket.entity';
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

@Injectable()
export class AdminService implements OnModuleInit {
    private readonly logger = new Logger(AdminService.name);
    private static readonly ADMIN_USER_SELECT = {
        id: true,
        username: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        status: true,
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

    async getUsers(pagination: PaginationDto, status?: UserStatus, search?: string, role?: UserRole, plan?: string) {
        const qb = this.userRepository.createQueryBuilder('user');
        qb.select([...AdminService.ADMIN_USER_QUERY_SELECT_COLUMNS]);

        if (status) qb.andWhere('user.status = :status', { status });
        if (role) qb.andWhere('user.role = :role', { role });
        if (search) {
            qb.andWhere(
                '(user.id::text = :exactSearch OR user.firstName ILIKE :likeSearch OR user.lastName ILIKE :likeSearch OR CONCAT(user.firstName, \' \', user.lastName) ILIKE :likeSearch OR user.email ILIKE :likeSearch OR user.username ILIKE :likeSearch)',
                { exactSearch: search.trim(), likeSearch: `%${search.trim()}%` },
            );
        }
        if (plan) {
            qb.innerJoin(
                'subscriptions',
                'sub',
                'sub."userId" = user.id AND sub.status = :subStatus',
                { subStatus: SubscriptionStatus.ACTIVE },
            );
            qb.leftJoin('plans', 'planEntity', 'planEntity.id = sub."planId"');
            qb.andWhere('(planEntity.code = :plan OR sub.plan = :plan)', { plan });
        }

        qb.orderBy('user.createdAt', 'DESC')
            .skip(pagination.skip)
            .take(pagination.limit);

        const [users, total] = await qb.getManyAndCount();
        return {
            users: users.map((user) => this.normalizeUserState(user)),
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

        const profile = await this.profileRepository.findOne({ where: { userId } });
        const photos = await this.photoRepository.find({ where: { userId } });
        const subscription = await this.subscriptionRepository.findOne({
            where: { userId },
            order: { createdAt: 'DESC' },
            relations: ['planEntity'],
        });

        // Compute premium display fields
        const now = new Date();
        const premiumExpiryDate = user.premiumExpiryDate ? new Date(user.premiumExpiryDate) : null;
        const premiumRemainingDays = premiumExpiryDate
            ? Math.max(0, Math.ceil((premiumExpiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
            : 0;
        const premiumIsExpired = premiumExpiryDate ? premiumExpiryDate < now : false;

        return {
            user: this.normalizeUserState(user),
            profile,
            photos,
            subscription,
            premium: {
                isPremium: user.isPremium,
                startDate: user.premiumStartDate,
                expiryDate: user.premiumExpiryDate,
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
        Object.assign(user, incoming);
        const savedUser = await this.userRepository.save(user);

        if (Object.keys(profileUpdate).length > 0) {
            const profile = await this.profileRepository.findOne({ where: { userId } });
            if (!profile) {
                throw new BadRequestException('Cannot update profile fields because this user has no profile yet.');
            }
            Object.assign(profile, profileUpdate);
            await this.profileRepository.save(profile);
        }

        return this.normalizeUserState(savedUser);
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

    async getConversations(pagination: PaginationDto, search?: string) {
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
            qb.andWhere(
                `(user1.firstName ILIKE :q OR user1.lastName ILIKE :q OR user2.firstName ILIKE :q OR user2.lastName ILIKE :q)`,
                { q: `%${search}%` },
            );
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
                .filter(message => (message.content || '').toLowerCase().includes(normalizedSearch));

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
            .leftJoin('subscriptions', 's', 's."userId" = u.id')
            .where('u.status = :status', { status: UserStatus.ACTIVE });

        if (filters.ageMin) {
            qb.andWhere(`(p.dateOfBirth IS NULL OR date_part('year', age(p.dateOfBirth)) >= :ageMin)`, { ageMin: filters.ageMin });
        }
        if (filters.ageMax) {
            qb.andWhere(`(p.dateOfBirth IS NULL OR date_part('year', age(p.dateOfBirth)) <= :ageMax)`, { ageMax: filters.ageMax });
        }
        if (filters.gender && filters.gender !== 'all') {
            qb.andWhere('u.gender = :gender', { gender: filters.gender });
        }
        if (filters.premiumOnly) {
            qb.leftJoin('plans', 'sp', 'sp.id = s."planId"');
            qb.andWhere('s.status IN (:...premiumStatuses)', {
                premiumStatuses: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
            });
            qb.andWhere("COALESCE(sp.code, s.plan, 'free') != :freePlan", { freePlan: 'free' });
        }
        if (filters.country) {
            qb.andWhere('p.country ILIKE :country', { country: `%${filters.country}%` });
        }
        if (filters.city) {
            qb.andWhere('p.city ILIKE :city', { city: `%${filters.city}%` });
        }
        if (filters.recentOnly && filters.recentDays) {
            const since = new Date();
            since.setDate(since.getDate() - Number(filters.recentDays));
            qb.andWhere('u.lastLoginAt >= :since', { since });
        }

        return qb.select(['u.id']).getMany();
    }

    async previewNotificationRecipients(filters: Record<string, any>) {
        const users = await this.findFilteredUsers(filters);
        return { recipientCount: users.length, filters };
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
        await this.notificationsService.sendTicketNotification(
            ticket.userId,
            'Support Reply',
            `Your ticket "${ticket.subject}" has been answered.`,
            { ticketId: ticket.id, status: ticket.status },
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
        });

        const savedSubscription = await this.subscriptionRepository.save(sub);
        await this.subscriptionsService.syncUserPremiumState(userId);
        return savedSubscription;
    }

    // â”€â”€â”€ SUBSCRIPTIONS OVERVIEW â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async getSubscriptions(pagination: PaginationDto, plan?: string) {
        const qb = this.subscriptionRepository
            .createQueryBuilder('subscription')
            .leftJoinAndSelect('subscription.user', 'user')
            .leftJoinAndSelect('subscription.planEntity', 'planEntity')
            .orderBy('subscription.createdAt', 'DESC')
            .skip(pagination.skip)
            .take(pagination.limit);

        if (plan) {
            qb.andWhere('(planEntity.code = :plan OR subscription.plan = :plan)', { plan });
        }

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

        const updatedUser = await this.userRepository.findOne({ where: { id: userId } });
        return updatedUser ? this.normalizeUserState(updatedUser) : null;
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

    async searchUsers(query: string, pagination: PaginationDto) {
        return this.getUsers(pagination, undefined, query);
    }

    async getPendingVerifications() {
        const pendingStatus = VerificationStatus.PENDING;
        const fallbackStatus = VerificationStatus.NOT_SUBMITTED;
        const users = await this.userRepository
            .createQueryBuilder('user')
            .select([...AdminService.ADMIN_USER_QUERY_SELECT_COLUMNS])
            .where(
                '(COALESCE(user.verification->\'selfie\'->>\'status\', :fallbackStatus) = :pendingStatus OR (user."selfieUrl" IS NOT NULL AND user."selfieVerified" = false))',
                { pendingStatus, fallbackStatus },
            )
            .orWhere(
                'COALESCE(user.verification->\'marital_status\'->>\'status\', :fallbackStatus) = :pendingStatus',
                { pendingStatus, fallbackStatus },
            )
            .orderBy('user.createdAt', 'DESC')
            .getMany();

        return users.map((user) => this.normalizeUserState(user));
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
        return {
            ...user,
            verification: normalizeVerificationState(user.verification),
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
            },
        });
        if (!user) throw new NotFoundException('User not found');

        const verification = normalizeVerificationState(user.verification);
        const existing = verification[field];
        const now = new Date().toISOString();
        const url = existing.url || (field === 'selfie' ? user.selfieUrl : null);

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
                        ? rejectionReason || 'Your verification was rejected.'
                        : 'Your verification is pending review.',
            data: {
                verificationType: field,
                status,
                rejectionReason: status === VerificationStatus.REJECTED ? rejectionReason || null : null,
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
}


import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
    User,
    UserStatus,
    VerificationStatus,
    normalizeVerificationState,
} from '../../database/entities/user.entity';
import { Profile } from '../../database/entities/profile.entity';
import { Photo, PhotoModerationStatus } from '../../database/entities/photo.entity';
import { Like, LikeType } from '../../database/entities/like.entity';
import { Boost } from '../../database/entities/boost.entity';
import { Match, MatchStatus } from '../../database/entities/match.entity';
import { Conversation } from '../../database/entities/conversation.entity';
import { Message, MessageType } from '../../database/entities/message.entity';
import { RematchRequest, RematchStatus } from '../../database/entities/rematch-request.entity';
import { RedisService } from '../redis/redis.service';
import { CloudinaryService } from '../photos/cloudinary.service';
type AccountClosureAction = 'deactivate' | 'delete';
type CloseAccountPayload = {
    action?: AccountClosureAction;
    reason?: string;
    details?: string;
    hardDelete?: boolean;
};
@Injectable()
export class UsersService {
    private static readonly uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(Profile)
        private readonly profileRepository: Repository<Profile>,
        @InjectRepository(Photo)
        private readonly photoRepository: Repository<Photo>,
        @InjectRepository(Like)
        private readonly likeRepository: Repository<Like>,
        @InjectRepository(Boost)
        private readonly boostRepository: Repository<Boost>,
        @InjectRepository(Match)
        private readonly matchRepository: Repository<Match>,
        @InjectRepository(Conversation)
        private readonly conversationRepository: Repository<Conversation>,
        @InjectRepository(Message)
        private readonly messageRepository: Repository<Message>,
        @InjectRepository(RematchRequest)
        private readonly rematchRepository: Repository<RematchRequest>,
        private readonly redisService: RedisService,
    ) { }
    private static readonly SAFE_USER_SELECT = {
        id: true,
        username: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        status: true,
        statusReason: true,
        isPremium: true,
        premiumStartDate: true,
        premiumExpiryDate: true,
        subscriptionPlanId: true,
        isGhostModeEnabled: true,
        isPassportActive: true,
        realLocation: true,
        passportLocation: true,
        verification: true,
        emailVerified: true,
        selfieVerified: true,
        selfieUrl: true,
        documentUrl: true,
        documentType: true,
        documentVerified: true,
        documentVerifiedAt: true,
        documentRejectionReason: true,
        fcmToken: true,
        notificationsEnabled: true,
        matchNotifications: true,
        messageNotifications: true,
        likeNotifications: true,
        profileVisitorNotifications: true,
        eventsNotifications: true,
        safetyAlertNotifications: true,
        promotionsNotifications: true,
        inAppRecommendationNotifications: true,
        weeklySummaryNotifications: true,
        connectionRequestNotifications: true,

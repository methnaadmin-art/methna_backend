import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not } from 'typeorm';
import { Match, MatchStatus } from '../../database/entities/match.entity';
import { Like } from '../../database/entities/like.entity';
import { Profile } from '../../database/entities/profile.entity';
import { UserPreference } from '../../database/entities/user-preference.entity';
import { BlockedUser } from '../../database/entities/blocked-user.entity';
import { Photo } from '../../database/entities/photo.entity';
import { User, UserStatus } from '../../database/entities/user.entity';
import { Conversation } from '../../database/entities/conversation.entity';
import { RedisService } from '../redis/redis.service';
import { CloudinaryService } from '../photos/cloudinary.service';
import { PaginationDto } from '../../common/dto/pagination.dto';

@Injectable()
export class MatchesService {
    private readonly logger = new Logger(MatchesService.name);

    constructor(
        @InjectRepository(Match)
        private readonly matchRepository: Repository<Match>,
        @InjectRepository(Like)
        private readonly likeRepository: Repository<Like>,
        @InjectRepository(Profile)
        private readonly profileRepository: Repository<Profile>,
        @InjectRepository(UserPreference)
        private readonly preferenceRepository: Repository<UserPreference>,
        @InjectRepository(BlockedUser)
        private readonly blockedUserRepository: Repository<BlockedUser>,
        @InjectRepository(Photo)
        private readonly photoRepository: Repository<Photo>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(Conversation)
        private readonly conversationRepository: Repository<Conversation>,
        private readonly redisService: RedisService,
    ) { }

    async getMatches(userId: string, pagination: PaginationDto) {
        const [matches, total] = await this.matchRepository.findAndCount({
            where: [
                { user1Id: userId, status: MatchStatus.ACTIVE },
                { user2Id: userId, status: MatchStatus.ACTIVE },
            ],
            relations: ['user1', 'user2'],
            order: { matchedAt: 'DESC' },
            skip: pagination.skip,
            take: pagination.limit,
        });

        // Batch fetch photos for all matched users (avoids N+1)
        const otherUserIds = matches.map(m => m.user1Id === userId ? m.user2Id : m.user1Id);
        const photos = otherUserIds.length > 0
            ? await this.photoRepository
                .createQueryBuilder('photo')
                .where('photo.userId IN (:...otherUserIds)', { otherUserIds })
                .andWhere('photo.isMain = :isMain', { isMain: true })
                .andWhere('photo.moderationStatus = :approvedStatus', { approvedStatus: 'approved' })
                .getMany()
            : [];
        const photoMap = new Map(
            photos.map((photo) => {
                const variants = CloudinaryService.buildImageUrls(photo.url);
                return [
                    photo.userId,
                    {
                        thumbnailUrl: variants.thumbnailUrl,
                        mediumUrl: variants.cardUrl,
                        cardUrl: variants.cardUrl,
                        profileUrl: variants.profileUrl,
                        fullscreenUrl: variants.fullscreenUrl,
                    },
                ];
            }),
        );

        // Batch check online status via Redis
        const onlineChecks = await Promise.all(
            otherUserIds.map(id => this.redisService.isUserOnline(id)),
        );
        const onlineMap = new Map(otherUserIds.map((id, i) => [id, onlineChecks[i]]));

        const enriched = matches.map((match) => {
            const otherUserId = match.user1Id === userId ? match.user2Id : match.user1Id;
            const otherUser = match.user1Id === userId ? match.user2 : match.user1;
            const hasActivePremium = this.hasActivePremiumEntitlement(otherUser);
            const photoSet = photoMap.get(otherUserId);
            return {
                id: match.id,
                matchedAt: match.matchedAt,
                user: {
                    id: otherUser.id,
                    firstName: otherUser.firstName,
                    lastName: otherUser.lastName,

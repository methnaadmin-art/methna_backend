import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus } from '../../database/entities/user.entity';
import { Profile } from '../../database/entities/profile.entity';
import { Photo, PhotoModerationStatus } from '../../database/entities/photo.entity';
import { Like, LikeType } from '../../database/entities/like.entity';
import { Boost } from '../../database/entities/boost.entity';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class UsersService {
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
        surveyNotifications: true,
        readReceipts: true,
        typingIndicator: true,
        autoDownloadMedia: true,
        receiveDMs: true,
        locationEnabled: true,
        boostedUntil: true,
        isShadowBanned: true,
        trustScore: true,
        flagCount: true,
        lastKnownIp: true,
        deviceCount: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
    } as const;

    async findById(id: string): Promise<User> {
        const user = await this.userRepository.findOne({
            where: { id },
            select: UsersService.SAFE_USER_SELECT,
        });
        if (!user) throw new NotFoundException('User not found');
        return user;
    }

    async findByEmail(email: string): Promise<User> {
        const user = await this.userRepository.findOne({
            where: { email },
            select: UsersService.SAFE_USER_SELECT,
        });
        if (!user) throw new NotFoundException('User not found');
        return user;
    }

    async getMe(userId: string) {
        const user = await this.findById(userId);

        // Load profile + photos + stats
        const [profile, photos, sentComplimentsCount, profileBoostsCount] = await Promise.all([
            this.profileRepository.findOne({ where: { userId } }),
            this.photoRepository.find({
                where: { userId },
                order: { isMain: 'DESC', order: 'ASC' },
            }),
            this.likeRepository.count({
                where: { likerId: userId, type: LikeType.COMPLIMENT },
            }),
            this.boostRepository.count({
                where: { userId },
            }),
        ]);

        return {
            ...user,
            profile: profile || null,
            photos: photos || [],
            sentComplimentsCount,
            profileBoostsCount,
        };
    }

    // Fields a user is allowed to modify on their own account
    private static readonly ALLOWED_UPDATE_FIELDS = new Set([
        'firstName', 'lastName', 'phone', 'username',
        'notificationsEnabled', 'matchNotifications',
        'messageNotifications', 'likeNotifications',
        'profileVisitorNotifications', 'eventsNotifications',
        'safetyAlertNotifications', 'promotionsNotifications',
        'inAppRecommendationNotifications', 'weeklySummaryNotifications',
        'connectionRequestNotifications', 'surveyNotifications',
        'readReceipts', 'typingIndicator', 'autoDownloadMedia', 'receiveDMs',
        'locationEnabled',
    ]);

    async updateMe(
        userId: string,
        updateData: Partial<User>,
    ): Promise<User> {
        // Strip any fields the user is not allowed to set (prevents privilege escalation)
        const safeData: Record<string, any> = {};
        for (const [key, value] of Object.entries(updateData)) {
            if (UsersService.ALLOWED_UPDATE_FIELDS.has(key)) {
                safeData[key] = key === 'username' && typeof value === 'string'
                    ? value.trim().toLowerCase()
                    : value;
            }
        }

        if (updateData.status !== undefined) {
            if (updateData.status !== UserStatus.DEACTIVATED) {
                throw new BadRequestException('Invalid status update');
            }
            safeData.status = UserStatus.DEACTIVATED;
        }

        if (safeData.username !== undefined) {
            if (!safeData.username) {
                throw new BadRequestException('Username cannot be empty');
            }

            const existingUser = await this.userRepository.findOne({
                where: { username: safeData.username },
                select: {
                    id: true,
                },
            });
            if (existingUser && existingUser.id !== userId) {
                throw new ConflictException('Username already taken');
            }
        }

        if (Object.keys(safeData).length > 0) {
            await this.userRepository.update(userId, safeData);
        }
        return this.findById(userId);
    }

    async softDelete(userId: string): Promise<void> {
        await this.userRepository.softDelete(userId);
    }

    async getPublicProfile(userId: string): Promise<Partial<User>> {
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                role: true,
                selfieVerified: true,
                createdAt: true,
            },
            relations: ['profile'],
        });
        if (!user) throw new NotFoundException('User not found');

        // Only return approved photos to other users
        const photos = await this.photoRepository.find({
            where: { userId, moderationStatus: PhotoModerationStatus.APPROVED },
            order: { isMain: 'DESC', order: 'ASC' },
        });

        // Explicit whitelist — never expose sensitive fields to other users
        return {
            id: user.id,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            selfieVerified: user.selfieVerified,
            createdAt: user.createdAt,
            profile: user.profile,
            photos: photos || [],
        } as Partial<User>;
    }

    async updateStatus(userId: string, status: UserStatus): Promise<void> {
        await this.userRepository.update(userId, { status });
    }

    async findAll(page: number, limit: number) {
        const [users, total] = await this.userRepository.findAndCount({
            skip: (page - 1) * limit,
            take: limit,
            relations: ['profile', 'photos'],
            order: { createdAt: 'DESC' },
        });
        return { users, total, page, limit };
    }

    async isUsernameAvailable(username: string): Promise<boolean> {
        const user = await this.userRepository.findOne({
            where: { username: username.toLowerCase() },
            select: {
                id: true,
                username: true,
                status: true,
                emailVerified: true,
            },
        });
        if (!user) return true;
        // Username held by an unverified user is considered available
        if (user.status === UserStatus.PENDING_VERIFICATION && !user.emailVerified) {
            return true;
        }
        return false;
    }
}

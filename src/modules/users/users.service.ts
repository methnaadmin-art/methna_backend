import {
    Injectable,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus } from '../../database/entities/user.entity';
import { Profile } from '../../database/entities/profile.entity';
import { Photo } from '../../database/entities/photo.entity';
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

    async findById(id: string): Promise<User> {
        const user = await this.userRepository.findOne({ where: { id } });
        if (!user) throw new NotFoundException('User not found');
        return user;
    }

    async findByEmail(email: string): Promise<User> {
        const user = await this.userRepository.findOne({ where: { email } });
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
                safeData[key] = value;
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
        const user = await this.findById(userId);
        // Explicit whitelist — never expose sensitive fields to other users
        return {
            id: user.id,
            username: user.username,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            selfieVerified: user.selfieVerified,
            createdAt: user.createdAt,
        } as Partial<User>;
    }

    async updateStatus(userId: string, status: UserStatus): Promise<void> {
        await this.userRepository.update(userId, { status });
    }

    async findAll(page: number, limit: number) {
        const [users, total] = await this.userRepository.findAndCount({
            skip: (page - 1) * limit,
            take: limit,
            order: { createdAt: 'DESC' },
        });
        return { users, total, page, limit };
    }

    async isUsernameAvailable(username: string): Promise<boolean> {
        const count = await this.userRepository.count({
            where: { username },
        });
        return count === 0;
    }
}

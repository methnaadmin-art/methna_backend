import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { ProfileView } from '../../database/entities/profile-view.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class ProfileViewsService {
    private readonly logger = new Logger(ProfileViewsService.name);
    private static readonly uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    constructor(
        @InjectRepository(ProfileView)
        private readonly profileViewRepository: Repository<ProfileView>,
        private readonly notificationsService: NotificationsService,
        private readonly redisService: RedisService,
    ) { }

    async recordView(viewerId: string, viewedId: string): Promise<void> {
        if (!viewerId || !viewedId) {
            this.logger.warn(`recordView skipped: viewerId=${viewerId}, viewedId=${viewedId}`);
            return;
        }
        if (!ProfileViewsService.uuidPattern.test(viewerId) ||
            !ProfileViewsService.uuidPattern.test(viewedId)) {
            throw new BadRequestException('Invalid profile id');
        }
        if (viewerId === viewedId) return;

        // Throttle: only record one view per viewer-viewed pair per hour
        const throttleKey = `pv:${viewerId}:${viewedId}`;
        const alreadyViewed = await this.redisService.get(throttleKey);
        if (alreadyViewed) return;

        await this.profileViewRepository.save({
            viewerId,
            viewedId,
        });

        await this.redisService.set(throttleKey, '1', 3600); // 1 hour throttle

        // Send notification (throttled: max 1 per viewed user per day)
        const notifKey = `pv_notif:${viewedId}:${new Date().toISOString().split('T')[0]}`;
        const notifCount = parseInt(await this.redisService.get(notifKey) || '0', 10);
        if (notifCount < 10) {
            await this.notificationsService.createNotification(viewedId, {
                type: 'profile_view',
                title: 'Someone viewed your profile',
                body: 'A user viewed your profile. Upgrade to Premium to see who!',
                data: { viewerId },
            });
            await this.redisService.set(notifKey, String(notifCount + 1), 86400);
        }
    }

    async getMyViewers(userId: string, days: number = 30, page: number = 1, limit: number = 20) {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        const [views, total] = await this.profileViewRepository.findAndCount({
            where: { viewedId: userId, createdAt: MoreThanOrEqual(since) },
            relations: ['viewer'],
            order: { createdAt: 'DESC' },
            skip: (page - 1) * limit,
            take: limit,
        });

        return {
            views: views.map(v => ({
                viewerId: v.viewerId,
                firstName: v.viewer?.firstName,
                lastName: v.viewer?.lastName,
                viewedAt: v.createdAt,
            })),
            total,
            page,
            limit,
        };
    }

    async getViewCount(userId: string, days: number = 30): Promise<number> {
        const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        return this.profileViewRepository.count({
            where: { viewedId: userId, createdAt: MoreThanOrEqual(since) },
        });
    }
}

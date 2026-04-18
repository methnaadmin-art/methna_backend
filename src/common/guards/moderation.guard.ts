import {
    CanActivate,
    ExecutionContext,
    Injectable,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus } from '../../database/entities/user.entity';
import { RedisService } from '../../modules/redis/redis.service';

export const MODERATION_KEY = 'moderation';
export const MODERATION_NONE = 'none';
export const MODERATION_LIMITED = 'limited';
export const MODERATION_SUSPENDED = 'suspended';
export const MODERATION_BANNED = 'banned';

/**
 * Moderation levels for route protection.
 * - 'none'       → only BANNED users are blocked
 * - 'limited'    → LIMITED, SHADOW_SUSPENDED, BANNED (and other hard blocks) are blocked
 * - 'suspended'  → LIMITED, SUSPENDED, SHADOW_SUSPENDED, BANNED (and hard blocks) are blocked
 * - 'banned'     → only BANNED users are blocked (everyone else allowed)
 */
export type ModerationLevel = 'none' | 'limited' | 'suspended' | 'banned';

/**
 * Guard that checks user moderation status on every request.
 *
 * Usage:
 *   @SetMetadata('moderation', 'limited')  // block LIMITED+ users
 *   @UseGuards(ModerationGuard)
 *
 * If no @ModerationLevel decorator is set, defaults to 'limited'
 * (blocks LIMITED, SHADOW_SUSPENDED, BANNED and hard-block statuses).
 */
@Injectable()
export class ModerationGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        private readonly redisService: RedisService,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const requiredLevel = this.reflector.get<ModerationLevel>(
            MODERATION_KEY,
            context.getHandler(),
        ) || 'limited';

        const request = context.switchToHttp().getRequest();
        const userId = request.user?.sub || request.user?.id;

        if (!userId) return true; // No auth context — let JwtAuthGuard handle it

        const moderation = await this.getUserModeration(userId);

        // Check if moderation has expired — auto-revert to ACTIVE
        if (
            moderation.status !== UserStatus.ACTIVE &&
            moderation.status !== UserStatus.BANNED &&
            moderation.expiresAt &&
            new Date() > new Date(moderation.expiresAt)
        ) {
            await this.userRepository.update(userId, {
                status: UserStatus.ACTIVE,
                statusReason: null,
                moderationReasonCode: null,
                moderationReasonText: null,
                actionRequired: null,
                supportMessage: null,
                moderationExpiresAt: null,
            });
            await this.redisService.del(`user_status:${userId}`);
            moderation.status = UserStatus.ACTIVE;
        }

        if (this.isBlocked(moderation.status, requiredLevel)) {
            throw new ForbiddenException({
                message: this.getBlockedMessage(moderation.status),
                code: 'MODERATION_BLOCKED',
                status: moderation.status,
                reason: moderation.statusReason,
                moderationReasonCode: moderation.moderationReasonCode,
                moderationReasonText: moderation.moderationReasonText,
                actionRequired: moderation.actionRequired,
                supportMessage: moderation.supportMessage,
                isUserVisible: moderation.isUserVisible,
                expiresAt: moderation.expiresAt,
            });
        }

        // Attach status to request for downstream use
        request.userStatus = moderation.status;

        return true;
    }

    private async getUserModeration(userId: string): Promise<{
        status: UserStatus;
        statusReason: string | null;
        moderationReasonCode: string | null;
        moderationReasonText: string | null;
        actionRequired: string | null;
        supportMessage: string | null;
        isUserVisible: boolean;
        expiresAt: string | null;
    }> {
        const cacheKey = `user_status:${userId}`;
        const cachedModeration = await this.redisService
            .getJson<{
                status: UserStatus;
                statusReason: string | null;
                moderationReasonCode: string | null;
                moderationReasonText: string | null;
                actionRequired: string | null;
                supportMessage: string | null;
                isUserVisible: boolean;
                expiresAt: string | null;
            }>(cacheKey)
            .catch(() => null);

        if (cachedModeration?.status) {
            return cachedModeration;
        }

        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: [
                'id', 'status', 'statusReason',
                'moderationReasonCode', 'moderationReasonText',
                'actionRequired', 'supportMessage',
                'isUserVisible', 'moderationExpiresAt',
            ],
        });
        if (!user) {
            return {
                status: UserStatus.BANNED,
                statusReason: 'User not found',
                moderationReasonCode: null,
                moderationReasonText: null,
                actionRequired: null,
                supportMessage: null,
                isUserVisible: true,
                expiresAt: null,
            };
        }

        const moderation = {
            status: user.status,
            statusReason: user.statusReason,
            moderationReasonCode: user.moderationReasonCode,
            moderationReasonText: user.moderationReasonText,
            actionRequired: user.actionRequired,
            supportMessage: user.supportMessage,
            isUserVisible: user.isUserVisible,
            expiresAt: user.moderationExpiresAt?.toISOString() || null,
        };

        await this.redisService.setJson(cacheKey, moderation, 60).catch(() => undefined);
        return moderation;
    }

    private isBlocked(status: UserStatus, level: ModerationLevel): boolean {
        const blocked: Record<ModerationLevel, UserStatus[]> = {
            none: [UserStatus.BANNED],
            limited: [
                UserStatus.PENDING_VERIFICATION,
                UserStatus.REJECTED,
                UserStatus.DEACTIVATED,
                UserStatus.CLOSED,
                UserStatus.LIMITED,
                UserStatus.SHADOW_SUSPENDED,
                UserStatus.BANNED,
            ],
            suspended: [
                UserStatus.PENDING_VERIFICATION,
                UserStatus.REJECTED,
                UserStatus.DEACTIVATED,
                UserStatus.CLOSED,
                UserStatus.LIMITED,
                UserStatus.SUSPENDED,
                UserStatus.SHADOW_SUSPENDED,
                UserStatus.BANNED,
            ],
            banned: [UserStatus.BANNED],
        };
        return blocked[level]?.includes(status) ?? false;
    }

    private getBlockedMessage(status: UserStatus): string {
        switch (status) {
            case UserStatus.PENDING_VERIFICATION:
                return 'Your account is pending verification. Please complete verification and wait for approval.';
            case UserStatus.REJECTED:
                return 'Your verification was rejected. Please review the reason and submit new verification documents.';
            case UserStatus.BANNED:
                return 'Your account has been banned. Contact support for more information.';
            case UserStatus.SUSPENDED:
                return 'Your account is suspended. Contact support for more information.';
            case UserStatus.DEACTIVATED:
                return 'Your account is deactivated. Contact support to restore access.';
            case UserStatus.CLOSED:
                return 'Your account is closed. Contact support if this was a mistake.';
            case UserStatus.LIMITED:
                return 'Your account has limited access. Some features are restricted.';
            case UserStatus.SHADOW_SUSPENDED:
                return 'Your account has limited access. Some features are restricted.';
            default:
                return 'Access denied.';
        }
    }
}

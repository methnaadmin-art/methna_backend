import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import {
    ContentFlag,
    ContentFlagSource,
    ContentFlagStatus,
    ContentFlagType,
} from '../../database/entities/content-flag.entity';
import { RedisService } from '../redis/redis.service';

export enum BackgroundCheckStatus {
    NOT_STARTED = 'not_started',
    PENDING = 'pending',
    IN_PROGRESS = 'in_progress',
    PASSED = 'passed',
    FAILED = 'failed',
    ERROR = 'error',
}

export interface BackgroundCheckResult {
    status: BackgroundCheckStatus;
    checkId?: string;
    completedAt?: Date;
    details?: Record<string, any>;
}

@Injectable()
export class BackgroundCheckService {
    private readonly logger = new Logger(BackgroundCheckService.name);

    private bgStatusKey(userId: string): string {
        return `bg_check_status:${userId}`;
    }
    private bgCheckIdKey(userId: string): string {
        return `bg_check_id:${userId}`;
    }
    private bgCompletedAtKey(userId: string): string {
        return `bg_check_completed:${userId}`;
    }

    constructor(
        private readonly configService: ConfigService,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(ContentFlag)
        private readonly contentFlagRepository: Repository<ContentFlag>,
        private readonly redisService: RedisService,
    ) { }

    /**
     * Initiate a background check for a user.
     * When no provider key is configured, fall back to a manual-review workflow
     * instead of auto-passing the check.
     */
    async initiateCheck(userId: string, data: {
        fullName: string;
        dateOfBirth: string;
        ssn?: string;
        consentGiven: boolean;
    }): Promise<BackgroundCheckResult> {
        if (!data.consentGiven) {
            return { status: BackgroundCheckStatus.NOT_STARTED };
        }

        const apiKey = this.configService.get<string>('BACKGROUND_CHECK_API_KEY');
        const checkId = `bg_${Date.now()}_${userId.slice(0, 8)}`;

        if (!apiKey) {
            this.logger.warn('Background check API key not configured. Queuing manual review workflow.');
            await this.redisService.set(this.bgStatusKey(userId), BackgroundCheckStatus.PENDING, 0);
            await this.redisService.set(this.bgCheckIdKey(userId), checkId, 0);
            await this.redisService.del(this.bgCompletedAtKey(userId));

            await this.contentFlagRepository.save({
                userId,
                type: ContentFlagType.OTHER,
                status: ContentFlagStatus.PENDING,
                source: ContentFlagSource.AUTO_DETECTED,
                entityType: 'background_check',
                entityId: checkId,
                content: JSON.stringify({
                    fullName: data.fullName,
                    dateOfBirth: data.dateOfBirth,
                    consentGiven: data.consentGiven,
                    workflow: 'manual_review_required',
                }),
                confidenceScore: 1.0,
            });

            return {
                status: BackgroundCheckStatus.PENDING,
                checkId,
            };
        }

        try {
            await this.redisService.set(this.bgStatusKey(userId), BackgroundCheckStatus.IN_PROGRESS, 0);
            await this.redisService.set(this.bgCheckIdKey(userId), checkId, 0);
            await this.redisService.del(this.bgCompletedAtKey(userId));

            this.logger.log(`Background check queued for provider handoff for user ${userId}`);
            return {
                status: BackgroundCheckStatus.IN_PROGRESS,
                checkId,
            };
        } catch (error) {
            this.logger.error(`Background check initiation failed for user ${userId}`, (error as Error).message);
            await this.redisService.set(this.bgStatusKey(userId), BackgroundCheckStatus.ERROR, 0);
            return {
                status: BackgroundCheckStatus.ERROR,
                details: { error: (error as Error).message },
            };
        }
    }

    /**
     * Handle webhook callback from background check provider.
     */
    async handleWebhook(payload: any): Promise<void> {
        const userId = payload?.metadata?.userId;
        const status = payload?.status;

        if (!userId) {
            this.logger.warn('Background check webhook missing userId');
            return;
        }

        const checkStatus = this.mapProviderStatus(status);
        const isTerminalStatus = [
            BackgroundCheckStatus.PASSED,
            BackgroundCheckStatus.FAILED,
        ].includes(checkStatus);

        await this.redisService.set(this.bgStatusKey(userId), checkStatus, 0);
        if (isTerminalStatus) {
            await this.redisService.set(this.bgCompletedAtKey(userId), new Date().toISOString(), 0);
        }

        this.logger.log(`Background check updated for user ${userId}: ${checkStatus}`);
    }

    /**
     * Get the background check status for a user.
     */
    async getCheckStatus(userId: string): Promise<BackgroundCheckResult> {
        const storedStatus = await this.redisService.get(this.bgStatusKey(userId));
        const storedCheckId = await this.redisService.get(this.bgCheckIdKey(userId));
        const storedCompletedAt = await this.redisService.get(this.bgCompletedAtKey(userId));

        return {
            status: (storedStatus as BackgroundCheckStatus) || BackgroundCheckStatus.NOT_STARTED,
            checkId: storedCheckId || undefined,
            completedAt: storedCompletedAt ? new Date(storedCompletedAt) : undefined,
        };
    }

    private mapProviderStatus(providerStatus: string): BackgroundCheckStatus {
        const map: Record<string, BackgroundCheckStatus> = {
            clear: BackgroundCheckStatus.PASSED,
            consider: BackgroundCheckStatus.FAILED,
            pending: BackgroundCheckStatus.PENDING,
            suspended: BackgroundCheckStatus.ERROR,
        };
        return map[providerStatus?.toLowerCase()] || BackgroundCheckStatus.PENDING;
    }
}

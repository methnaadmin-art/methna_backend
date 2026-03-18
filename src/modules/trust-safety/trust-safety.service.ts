import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { Profile } from '../../database/entities/profile.entity';
import { Like } from '../../database/entities/like.entity';
import { Message } from '../../database/entities/message.entity';
import { ContentFlag, ContentFlagType, ContentFlagStatus, ContentFlagSource } from '../../database/entities/content-flag.entity';
import { LoginHistory } from '../../database/entities/login-history.entity';
import { RedisService } from '../redis/redis.service';

const BAD_WORDS = [
    'fuck', 'shit', 'ass', 'bitch', 'dick', 'pussy', 'whore', 'slut',
    'nigger', 'faggot', 'retard', 'cunt', 'bastard', 'damn', 'cock',
    'porn', 'sex', 'nude', 'naked', 'hoe', 'thot',
];

@Injectable()
export class TrustSafetyService {
    private readonly logger = new Logger(TrustSafetyService.name);

    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(Profile)
        private readonly profileRepository: Repository<Profile>,
        @InjectRepository(Like)
        private readonly likeRepository: Repository<Like>,
        @InjectRepository(Message)
        private readonly messageRepository: Repository<Message>,
        @InjectRepository(ContentFlag)
        private readonly contentFlagRepository: Repository<ContentFlag>,
        @InjectRepository(LoginHistory)
        private readonly loginHistoryRepository: Repository<LoginHistory>,
        private readonly redisService: RedisService,
    ) { }

    // ─── CONTENT MODERATION (BAD WORDS FILTER) ─────────────

    filterBadWords(text: string): { clean: string; hasBadWords: boolean; flaggedWords: string[] } {
        const lowerText = text.toLowerCase();
        const flaggedWords: string[] = [];
        let clean = text;

        for (const word of BAD_WORDS) {
            const regex = new RegExp(`\\b${word}\\b`, 'gi');
            if (regex.test(lowerText)) {
                flaggedWords.push(word);
                clean = clean.replace(regex, '*'.repeat(word.length));
            }
        }

        return { clean, hasBadWords: flaggedWords.length > 0, flaggedWords };
    }

    async moderateMessage(userId: string, messageId: string, content: string): Promise<{ isClean: boolean; cleanContent: string }> {
        const result = this.filterBadWords(content);

        if (result.hasBadWords) {
            await this.contentFlagRepository.save({
                userId,
                type: ContentFlagType.BAD_WORD,
                status: ContentFlagStatus.PENDING,
                source: ContentFlagSource.AUTO_DETECTED,
                content: content,
                entityType: 'message',
                entityId: messageId,
                confidenceScore: 1.0,
            });

            // Decrement trust score
            await this.decrementTrustScore(userId, 2);
            this.logger.warn(`Bad words detected in message from user ${userId}: ${result.flaggedWords.join(', ')}`);
        }

        return { isClean: !result.hasBadWords, cleanContent: result.clean };
    }

    async moderateProfileText(userId: string, text: string, field: string): Promise<{ isClean: boolean; cleanText: string }> {
        const result = this.filterBadWords(text);

        if (result.hasBadWords) {
            await this.contentFlagRepository.save({
                userId,
                type: ContentFlagType.OFFENSIVE,
                source: ContentFlagSource.AUTO_DETECTED,
                content: text,
                entityType: 'profile',
                entityId: field,
                confidenceScore: 1.0,
            });

            await this.decrementTrustScore(userId, 5);
        }

        return { isClean: !result.hasBadWords, cleanText: result.clean };
    }

    // ─── FAKE ACCOUNT DETECTION ─────────────────────────────

    async detectSuspiciousBehavior(userId: string): Promise<{ isSuspicious: boolean; reasons: string[] }> {
        const reasons: string[] = [];

        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (!user) return { isSuspicious: false, reasons };

        const profile = await this.profileRepository.findOne({ where: { userId } });

        // 1. No profile photo after 24h
        const hoursSinceCreation = (Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60);
        if (!profile && hoursSinceCreation > 24) {
            reasons.push('no_profile_after_24h');
        }

        // 2. Extremely high swipe rate (>200 likes per day)
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const recentLikes = await this.likeRepository.count({
            where: { likerId: userId, isLike: true, createdAt: MoreThan(oneDayAgo) },
        });
        if (recentLikes > 200) {
            reasons.push('excessive_swipe_rate');
        }

        // 3. Low match engagement (many matches but no messages)
        const recentMessages = await this.messageRepository.count({
            where: { senderId: userId, createdAt: MoreThan(oneDayAgo) },
        });
        if (recentLikes > 50 && recentMessages === 0) {
            reasons.push('no_messages_despite_activity');
        }

        // 4. Multiple logins from different countries in 24h
        const recentLogins = await this.loginHistoryRepository.find({
            where: { userId, createdAt: MoreThan(oneDayAgo) },
        });
        const uniqueCountries = new Set(recentLogins.map(l => l.country).filter(Boolean));
        if (uniqueCountries.size > 3) {
            reasons.push('multiple_countries_24h');
        }

        // 5. Repetitive messages (spam pattern)
        if (recentMessages > 50) {
            const messages = await this.messageRepository.find({
                where: { senderId: userId, createdAt: MoreThan(oneDayAgo) },
                select: ['content'],
                take: 50,
            });
            const uniqueContent = new Set(messages.map(m => m.content.toLowerCase().trim()));
            if (uniqueContent.size < messages.length * 0.3) {
                reasons.push('repetitive_messages');
            }
        }

        const isSuspicious = reasons.length >= 2;

        if (isSuspicious) {
            await this.decrementTrustScore(userId, reasons.length * 5);

            await this.contentFlagRepository.save({
                userId,
                type: ContentFlagType.FAKE_PROFILE,
                source: ContentFlagSource.AUTO_DETECTED,
                content: JSON.stringify(reasons),
                entityType: 'user',
                entityId: userId,
                confidenceScore: Math.min(reasons.length * 0.25, 1.0),
            });

            this.logger.warn(`Suspicious behavior detected for user ${userId}: ${reasons.join(', ')}`);
        }

        return { isSuspicious, reasons };
    }

    // ─── SHADOW BANNING ─────────────────────────────────────

    async shadowBanUser(userId: string): Promise<void> {
        await this.userRepository.update(userId, { isShadowBanned: true });
        await this.redisService.set(`shadowban:${userId}`, '1', 0);
        this.logger.warn(`User ${userId} shadow banned`);
    }

    async removeShadowBan(userId: string): Promise<void> {
        await this.userRepository.update(userId, { isShadowBanned: false });
        await this.redisService.del(`shadowban:${userId}`);
    }

    async isShadowBanned(userId: string): Promise<boolean> {
        const cached = await this.redisService.get(`shadowban:${userId}`);
        if (cached !== null) return cached === '1';

        const user = await this.userRepository.findOne({ where: { id: userId }, select: ['id', 'isShadowBanned'] });
        const banned = user?.isShadowBanned ?? false;
        await this.redisService.set(`shadowban:${userId}`, banned ? '1' : '0', 3600);
        return banned;
    }

    // ─── SELFIE VS PROFILE PHOTO COMPARISON (MOCK AI) ──────

    async compareSelfieToPhotos(userId: string): Promise<{ match: boolean; confidence: number; message: string }> {
        const user = await this.userRepository.findOne({ where: { id: userId }, select: ['id', 'selfieUrl'] });

        if (!user?.selfieUrl) {
            return { match: false, confidence: 0, message: 'No selfie uploaded' };
        }

        // Mock AI face comparison
        // In production, this would call AWS Rekognition, Azure Face API, or similar
        // For now, simulate a confidence score
        const mockConfidence = 0.75 + Math.random() * 0.25; // 0.75-1.0 range
        const isMatch = mockConfidence > 0.80;

        if (isMatch) {
            await this.userRepository.update(userId, { selfieVerified: true });
            await this.incrementTrustScore(userId, 10);
        } else {
            await this.contentFlagRepository.save({
                userId,
                type: ContentFlagType.FAKE_PROFILE,
                source: ContentFlagSource.AUTO_DETECTED,
                content: `Selfie verification failed. Confidence: ${mockConfidence.toFixed(2)}`,
                entityType: 'user',
                entityId: userId,
                confidenceScore: 1 - mockConfidence,
            });
        }

        return {
            match: isMatch,
            confidence: parseFloat(mockConfidence.toFixed(2)),
            message: isMatch ? 'Selfie verified successfully' : 'Selfie does not match profile photos',
        };
    }

    // ─── TRUST SCORE MANAGEMENT ─────────────────────────────

    async decrementTrustScore(userId: string, amount: number): Promise<void> {
        await this.userRepository
            .createQueryBuilder()
            .update(User)
            .set({ trustScore: () => `GREATEST("trustScore" - ${amount}, 0)` })
            .where('id = :userId', { userId })
            .execute();

        // Auto shadow ban if trust score drops below 20
        const user = await this.userRepository.findOne({ where: { id: userId }, select: ['id', 'trustScore'] });
        if (user && user.trustScore < 20) {
            await this.shadowBanUser(userId);
        }
    }

    async incrementTrustScore(userId: string, amount: number): Promise<void> {
        await this.userRepository
            .createQueryBuilder()
            .update(User)
            .set({ trustScore: () => `LEAST("trustScore" + ${amount}, 100)` })
            .where('id = :userId', { userId })
            .execute();
    }

    async getTrustScore(userId: string): Promise<number> {
        const user = await this.userRepository.findOne({ where: { id: userId }, select: ['id', 'trustScore'] });
        return user?.trustScore ?? 100;
    }

    // ─── CONTENT FLAGS ADMIN ────────────────────────────────

    async getPendingFlags(page: number = 1, limit: number = 20) {
        const [flags, total] = await this.contentFlagRepository.findAndCount({
            where: { status: ContentFlagStatus.PENDING },
            relations: ['user'],
            order: { createdAt: 'DESC' },
            skip: (page - 1) * limit,
            take: limit,
        });

        return { flags, total, page, limit };
    }

    async resolveFlag(flagId: string, adminId: string, status: ContentFlagStatus, note?: string): Promise<void> {
        await this.contentFlagRepository.update(flagId, {
            status,
            reviewedById: adminId,
            reviewNote: note,
        });
    }
}

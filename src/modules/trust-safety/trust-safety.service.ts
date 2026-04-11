import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import {
    User,
    VerificationStatus,
    normalizeVerificationState,
} from '../../database/entities/user.entity';
import { Profile } from '../../database/entities/profile.entity';
import { Like } from '../../database/entities/like.entity';
import { Message } from '../../database/entities/message.entity';
import { ContentFlag, ContentFlagType, ContentFlagStatus, ContentFlagSource } from '../../database/entities/content-flag.entity';
import { LoginHistory } from '../../database/entities/login-history.entity';
import { RedisService } from '../redis/redis.service';
import { CloudinaryService } from '../photos/cloudinary.service';
import { BackgroundCheckStatus } from './background-check.service';

const BAD_WORDS = [
    'fuck', 'shit', 'ass', 'bitch', 'dick', 'pussy', 'whore', 'slut',
    'nigger', 'faggot', 'retard', 'cunt', 'bastard', 'damn', 'cock',
    'porn', 'sex', 'nude', 'naked', 'hoe', 'thot',
];

@Injectable()
export class TrustSafetyService {
    private readonly logger = new Logger(TrustSafetyService.name);

    private selfieStatusKey(userId: string): string {
        return `selfie_status:${userId}`;
    }

    private idDocumentStatusKey(userId: string): string {
        return `id_doc_status:${userId}`;
    }

    private marriageCertStatusKey(userId: string): string {
        return `marriage_cert_status:${userId}`;
    }

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
        private readonly cloudinaryService: CloudinaryService,
    ) { }

    // â”€â”€â”€ VERIFICATION UPLOADS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    async uploadSelfie(userId: string, file: Express.Multer.File) {
        if (!file) throw new BadRequestException('No selfie file provided');

        const result = await this.cloudinaryService.uploadImage(file);
        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (!user) throw new BadRequestException('User not found');

        const verification = normalizeVerificationState(user.verification);
        verification.selfie = {
            ...verification.selfie,
            status: VerificationStatus.PENDING,
            url: result.secure_url,
            rejectionReason: null,
            submittedAt: new Date().toISOString(),
            reviewedAt: null,
            reviewedBy: null,
        };

        await this.userRepository.update(userId, {
            selfieUrl: result.secure_url,
            selfieVerified: false,
            verification,
        });
        await this.redisService.set(this.selfieStatusKey(userId), 'pending_review');

        this.logger.log(`Selfie uploaded for user ${userId}`);
        return {
            message: 'Selfie uploaded successfully. Verification review will begin automatically.',
            selfieUrl: result.secure_url,
            status: VerificationStatus.PENDING,
        };
    }

    async uploadIdDocument(
        userId: string,
        file: Express.Multer.File,
        documentType?: string,
    ) {
        if (!file) throw new BadRequestException('No document file provided');

        const allowedDocumentTypes = ['passport', 'national_id', 'driving_license'];
        const normalizedDocumentType = allowedDocumentTypes.includes(documentType || '')
            ? documentType!
            : 'national_id';

        const result = await this.cloudinaryService.uploadImage(file);
        await this.userRepository.update(userId, {
            documentUrl: result.secure_url,
            documentType: normalizedDocumentType,
            documentVerified: false,
            documentVerifiedAt: null,
            documentRejectionReason: null,
        } as any);

        await this.redisService.set(`id_doc:${userId}`, result.secure_url, 0);
        await this.redisService.set(this.idDocumentStatusKey(userId), 'pending_review');

        await this.contentFlagRepository.save({
            userId,
            type: ContentFlagType.OTHER,
            status: ContentFlagStatus.PENDING,
            source: ContentFlagSource.USER_REPORT,
            content: `Identity document (${normalizedDocumentType}) uploaded for verification: ${result.secure_url}`,
            entityType: 'verification',
            entityId: userId,
            confidenceScore: 1.0,
        });

        this.logger.log(`Identity document uploaded for user ${userId} (${normalizedDocumentType})`);
        return {
            message: 'Identity document uploaded. It will be reviewed by our team within 24-48 hours.',
            status: 'pending_review',
            documentType: normalizedDocumentType,
            documentUrl: result.secure_url,
        };
    }

    async uploadMarriageCert(userId: string, file: Express.Multer.File) {
        if (!file) throw new BadRequestException('No certificate file provided');

        const result = await this.cloudinaryService.uploadImage(file);
        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (!user) throw new BadRequestException('User not found');

        const verification = normalizeVerificationState(user.verification);
        verification.marital_status = {
            ...verification.marital_status,
            status: VerificationStatus.PENDING,
            url: result.secure_url,
            rejectionReason: null,
            submittedAt: new Date().toISOString(),
            reviewedAt: null,
            reviewedBy: null,
        };

        await this.userRepository.update(userId, { verification });

        // Store marriage cert URL in Redis (pending admin review)
        await this.redisService.set(`marriage_cert:${userId}`, result.secure_url, 0);
        await this.redisService.set(this.marriageCertStatusKey(userId), 'pending_review');

        // Create a content flag for admin review
        await this.contentFlagRepository.save({
            userId,
            type: ContentFlagType.OTHER,
            status: ContentFlagStatus.PENDING,
            source: ContentFlagSource.USER_REPORT,
            content: `Marriage certificate uploaded for verification: ${result.secure_url}`,
            entityType: 'verification',
            entityId: userId,
            confidenceScore: 1.0,
        });

        this.logger.log(`Marriage certificate uploaded for user ${userId}`);
        return {
            message: 'Marriage certificate uploaded. It will be reviewed by our team.',
            status: VerificationStatus.PENDING,
            documentUrl: result.secure_url,
        };
    }

    async getVerificationStatus(userId: string) {
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: [
                'id',
                'selfieVerified',
                'emailVerified',
                'selfieUrl',
                'trustScore',
                'verification',
                'documentVerified',
                'documentUrl',
                'documentType',
                'documentVerifiedAt',
                'documentRejectionReason',
            ],
        });

        const idDocUrl = await this.redisService.get(`id_doc:${userId}`);
        const verification = normalizeVerificationState(user?.verification);
        const marriageCertUrl =
            verification.marital_status.url || (await this.redisService.get(`marriage_cert:${userId}`));
        const selfieStatus = verification.selfie.status;
        const idDocumentStatus = user?.documentVerified
            ? 'verified'
            : (await this.redisService.get(this.idDocumentStatusKey(userId))) ||
              (user?.documentRejectionReason
                  ? 'reverify_required'
                  : ((idDocUrl || user?.documentUrl) ? 'pending_review' : 'not_uploaded'));
        const marriageCertStatus = verification.marital_status.status;

        return {
            emailVerified: user?.emailVerified ?? false,
            selfieVerified: user?.selfieVerified ?? false,
            selfieUploaded: !!verification.selfie.url,
            selfieStatus,
            verification,
            idDocumentUploaded: !!(idDocUrl || user?.documentUrl),
            idDocumentStatus,
            documentUrl: user?.documentUrl || idDocUrl || null,
            documentType: user?.documentType || null,
            documentVerified: user?.documentVerified ?? false,
            documentVerifiedAt: user?.documentVerifiedAt ?? null,
            documentRejectionReason: user?.documentRejectionReason || null,
            marriageCertUploaded: !!marriageCertUrl,
            marriageCertStatus,
            marriageCertUrl,
            trustScore: user?.trustScore ?? 100,
        };
    }

    // â”€â”€â”€ CONTENT MODERATION (BAD WORDS FILTER) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    filterBadWords(text: string): { clean: string; hasBadWords: boolean; flaggedWords: string[] } {
        const flaggedWords: string[] = [];
        let clean = text;

        for (const word of BAD_WORDS) {
            // Use separate regex instances to avoid stateful lastIndex bug with 'g' flag
            const testRegex = new RegExp(`\\b${word}\\b`, 'i');
            if (testRegex.test(clean)) {
                flaggedWords.push(word);
                const replaceRegex = new RegExp(`\\b${word}\\b`, 'gi');
                clean = clean.replace(replaceRegex, '*'.repeat(word.length));
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

    // â”€â”€â”€ FAKE ACCOUNT DETECTION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    // â”€â”€â”€ SHADOW BANNING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    // â”€â”€â”€ SELFIE VS PROFILE PHOTO COMPARISON (MOCK AI) â”€â”€â”€â”€â”€â”€

    async compareSelfieToPhotos(
        userId: string,
    ): Promise<{ match: boolean; confidence: number; message: string; status: string }> {
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: ['id', 'selfieUrl', 'selfieVerified', 'verification'],
        });

        if (!user?.selfieUrl) {
            return {
                match: false,
                confidence: 0,
                message: 'No selfie uploaded',
                status: VerificationStatus.NOT_SUBMITTED,
            };
        }

        const verification = normalizeVerificationState(user.verification);

        if (user.selfieVerified) {
            await this.redisService.set(this.selfieStatusKey(userId), 'verified');
            return {
                match: true,
                confidence: 1,
                message: 'Selfie already verified',
                status: VerificationStatus.APPROVED,
            };
        }

        const existingPendingReview = await this.contentFlagRepository.findOne({
            where: {
                userId,
                entityType: 'selfie_verification',
                status: ContentFlagStatus.PENDING,
            },
            order: { createdAt: 'DESC' },
        });

        if (!existingPendingReview) {
            await this.contentFlagRepository.save({
                userId,
                type: ContentFlagType.OTHER,
                status: ContentFlagStatus.PENDING,
                source: ContentFlagSource.USER_REPORT,
                content: `Selfie verification submitted for manual review: ${user.selfieUrl}`,
                entityType: 'selfie_verification',
                entityId: userId,
                confidenceScore: 0.5,
            });
        }

        verification.selfie = {
            ...verification.selfie,
            status: VerificationStatus.PENDING,
            url: user.selfieUrl,
            rejectionReason: null,
            submittedAt: verification.selfie.submittedAt || new Date().toISOString(),
            reviewedAt: null,
            reviewedBy: null,
        };

        await this.userRepository.update(userId, {
            selfieVerified: false,
            verification,
        });
        await this.redisService.set(this.selfieStatusKey(userId), 'pending_review');
        this.logger.log(`Selfie verification queued for manual review for user ${userId}`);

        return {
            match: false,
            confidence: 0,
            message: 'Selfie submitted for manual review.',
            status: VerificationStatus.PENDING,
        };
    }

    // â”€â”€â”€ TRUST SCORE MANAGEMENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    // â”€â”€â”€ CONTENT FLAGS ADMIN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
        const flag = await this.contentFlagRepository.findOne({
            where: { id: flagId },
            select: ['id', 'userId', 'entityType', 'content'],
        });

        await this.contentFlagRepository.update(flagId, {
            status,
            reviewedById: adminId,
            reviewNote: note,
        });

        if (flag?.entityType === 'background_check') {
            const approved = status === ContentFlagStatus.ACTION_TAKEN || status === ContentFlagStatus.REVIEWED;
            await this.userRepository.update(flag.userId, {
                backgroundCheckStatus: approved
                    ? BackgroundCheckStatus.PASSED
                    : BackgroundCheckStatus.FAILED,
                backgroundCheckCompletedAt: new Date(),
            } as any);
        }

        if (flag?.entityType === 'selfie_verification') {
            const approved = status === ContentFlagStatus.ACTION_TAKEN || status === ContentFlagStatus.REVIEWED;
            await this.updateUserVerificationField(
                flag.userId,
                'selfie',
                approved ? VerificationStatus.APPROVED : VerificationStatus.REJECTED,
                approved ? null : (note ?? 'Selfie verification rejected'),
            );
            await this.redisService.set(
                this.selfieStatusKey(flag.userId),
                approved ? 'verified' : 'reverify_required',
            );
            if (approved) {
                await this.incrementTrustScore(flag.userId, 10);
            }
        }

        if (flag?.entityType === 'verification') {
            const approved = status === ContentFlagStatus.ACTION_TAKEN || status === ContentFlagStatus.REVIEWED;
            const normalizedContent = (flag.content ?? '').toLowerCase();

            if (normalizedContent.includes('id document')) {
                await this.userRepository.update(flag.userId, {
                    documentVerified: approved,
                    documentVerifiedAt: approved ? new Date() : null,
                    documentRejectionReason: approved
                        ? null
                        : (note ??
                              "Please upload a clearer passport, national ID, or driver's license."),
                } as any);
                await this.redisService.set(
                    this.idDocumentStatusKey(flag.userId),
                    approved ? 'verified' : 'reverify_required',
                );
            }

            if (normalizedContent.includes('marriage certificate')) {
                await this.updateUserVerificationField(
                    flag.userId,
                    'marital_status',
                    approved ? VerificationStatus.APPROVED : VerificationStatus.REJECTED,
                    approved ? null : (note ?? 'Marriage certificate verification rejected'),
                );
                await this.redisService.set(
                    this.marriageCertStatusKey(flag.userId),
                    approved ? 'verified' : 'reverify_required',
                );
            }
        }
    }

    private async updateUserVerificationField(
        userId: string,
        field: 'selfie' | 'marital_status',
        status: VerificationStatus,
        rejectionReason?: string | null,
    ): Promise<void> {
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: ['id', 'selfieUrl', 'selfieVerified', 'verification'],
        });

        if (!user) {
            return;
        }

        const verification = normalizeVerificationState(user.verification);
        const now = new Date().toISOString();
        const current = verification[field];

        verification[field] = {
            ...current,
            status,
            rejectionReason: status === VerificationStatus.REJECTED ? rejectionReason ?? null : null,
            reviewedAt:
                status === VerificationStatus.PENDING || status === VerificationStatus.NOT_SUBMITTED
                    ? null
                    : now,
            reviewedBy: null,
            submittedAt:
                status === VerificationStatus.NOT_SUBMITTED
                    ? null
                    : current.submittedAt || now,
            url: status === VerificationStatus.NOT_SUBMITTED ? null : current.url,
        };

        const updateData: any = {
            verification,
        };

        if (field === 'selfie') {
            updateData.selfieVerified = status === VerificationStatus.APPROVED;
            updateData.selfieUrl = verification.selfie.url;
        }

        await this.userRepository.update(userId, updateData);
    }
}








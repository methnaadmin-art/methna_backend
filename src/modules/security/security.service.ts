import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { UserDevice } from '../../database/entities/user-device.entity';
import { LoginHistory, LoginResult } from '../../database/entities/login-history.entity';
import { EmailBlacklist } from '../../database/entities/email-blacklist.entity';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class SecurityService {
    private readonly logger = new Logger(SecurityService.name);

    constructor(
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        @InjectRepository(UserDevice)
        private readonly deviceRepository: Repository<UserDevice>,
        @InjectRepository(LoginHistory)
        private readonly loginHistoryRepository: Repository<LoginHistory>,
        @InjectRepository(EmailBlacklist)
        private readonly emailBlacklistRepository: Repository<EmailBlacklist>,
        private readonly redisService: RedisService,
    ) { }

    // ─── DEVICE TRACKING ────────────────────────────────────

    async registerDevice(
        userId: string,
        deviceInfo: {
            fingerprint: string;
            name?: string;
            platform?: string;
            osVersion?: string;
            appVersion?: string;
            ipAddress?: string;
        },
    ): Promise<UserDevice> {
        const fingerprint = (deviceInfo.fingerprint || '').trim();
        if (!fingerprint) {
            throw new BadRequestException('Device fingerprint is required to register this device.');
        }

        let device = await this.deviceRepository.findOne({
            where: { userId, deviceFingerprint: fingerprint },
        });

        if (device) {
            device.lastActiveAt = new Date();
            device.ipAddress = deviceInfo.ipAddress || device.ipAddress;
            device.appVersion = deviceInfo.appVersion || device.appVersion;
            return this.deviceRepository.save(device);
        }

        // New device — check device count
        const deviceCount = await this.deviceRepository.count({ where: { userId } });
        if (deviceCount >= 5) {
            this.logger.warn(`User ${userId} exceeded device limit (${deviceCount} devices)`);
        }

        device = this.deviceRepository.create({
            userId,
            deviceFingerprint: fingerprint,
            deviceName: deviceInfo.name,
            platform: deviceInfo.platform,
            osVersion: deviceInfo.osVersion,
            appVersion: deviceInfo.appVersion,
            ipAddress: deviceInfo.ipAddress,
            lastActiveAt: new Date(),
        });

        const saved = await this.deviceRepository.save(device);

        // Update user device count
        await this.userRepository.update(userId, { deviceCount: deviceCount + 1 });

        return saved;
    }

    async getUserDevices(userId: string): Promise<UserDevice[]> {
        return this.deviceRepository.find({
            where: { userId },
            order: { lastActiveAt: 'DESC' },
        });
    }

    async revokeDevice(userId: string, deviceId: string): Promise<void> {
        await this.deviceRepository.delete({ id: deviceId, userId });
        const count = await this.deviceRepository.count({ where: { userId } });
        await this.userRepository.update(userId, { deviceCount: count });
    }

    // ─── IP-BASED RATE LIMITING ─────────────────────────────

    async checkIpRateLimit(ipAddress: string, endpoint: string, maxRequests: number = 100, windowSeconds: number = 3600): Promise<boolean> {
        const key = `ip_limit:${ipAddress}:${endpoint}`;
        const current = parseInt(await this.redisService.get(key) || '0', 10);

        if (current >= maxRequests) {
            this.logger.warn(`IP rate limit exceeded: ${ipAddress} on ${endpoint}`);
            return false; // Rate limited
        }

        await this.redisService.incr(key);
        if (current === 0) {
            await this.redisService.expire(key, windowSeconds);
        }

        return true; // Allowed
    }

    async getIpRequestCount(ipAddress: string, endpoint: string): Promise<number> {
        const key = `ip_limit:${ipAddress}:${endpoint}`;
        return parseInt(await this.redisService.get(key) || '0', 10);
    }

    // ─── SUSPICIOUS LOGIN DETECTION ─────────────────────────

    async recordLogin(
        userId: string,
        ipAddress: string,
        userAgent?: string,
        deviceFingerprint?: string,
    ): Promise<{ isSuspicious: boolean; reasons: string[] }> {
        const reasons: string[] = [];

        // 1. Check for rapid logins from different IPs
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentLogins = await this.loginHistoryRepository.find({
            where: { userId, createdAt: MoreThan(oneHourAgo) },
        });

        const uniqueIps = new Set(recentLogins.map(l => l.ipAddress));
        uniqueIps.add(ipAddress);
        if (uniqueIps.size > 5) {
            reasons.push('multiple_ips_in_hour');
        }

        // 2. Check for login from new country (if geo data available)
        const user = await this.userRepository.findOne({
            where: { id: userId },
            select: ['id', 'lastKnownIp'],
        });

        if (user?.lastKnownIp && user.lastKnownIp !== ipAddress) {
            // Simple check — in production, use a GeoIP service
            const knownIpPrefix = user.lastKnownIp.split('.').slice(0, 2).join('.');
            const currentIpPrefix = ipAddress.split('.').slice(0, 2).join('.');
            if (knownIpPrefix !== currentIpPrefix) {
                reasons.push('ip_range_changed');
            }
        }

        // 3. Check for failed login attempts
        const failedAttempts = await this.loginHistoryRepository.count({
            where: {
                userId,
                result: LoginResult.FAILED,
                createdAt: MoreThan(oneHourAgo),
            },
        });
        if (failedAttempts >= 3) {
            reasons.push('multiple_failed_attempts');
        }

        // 4. New device fingerprint
        if (deviceFingerprint) {
            const knownDevice = await this.deviceRepository.findOne({
                where: { userId, deviceFingerprint },
            });
            if (!knownDevice) {
                reasons.push('new_device');
            }
        }

        const isSuspicious = reasons.length >= 2;

        // Record the login
        await this.loginHistoryRepository.save({
            userId,
            ipAddress,
            userAgent,
            deviceFingerprint,
            result: isSuspicious ? LoginResult.SUSPICIOUS : LoginResult.SUCCESS,
            isSuspicious,
        });

        // Update last known IP
        await this.userRepository.update(userId, { lastKnownIp: ipAddress });

        if (isSuspicious) {
            this.logger.warn(`Suspicious login for user ${userId}: ${reasons.join(', ')}`);
        }

        return { isSuspicious, reasons };
    }

    async getLoginHistory(userId: string, limit: number = 20): Promise<LoginHistory[]> {
        return this.loginHistoryRepository.find({
            where: { userId },
            order: { createdAt: 'DESC' },
            take: limit,
        });
    }

    async recordFailedLogin(userId: string, ipAddress: string, reason: string): Promise<void> {
        await this.loginHistoryRepository.save({
            userId,
            ipAddress,
            result: LoginResult.FAILED,
            failureReason: reason,
            isSuspicious: false,
        });
    }

    // ─── EMAIL BLACKLIST ────────────────────────────────────

    async isEmailBlacklisted(email: string): Promise<boolean> {
        const domain = email.split('@')[1]?.toLowerCase();
        if (!domain) return false;

        // Check cache first
        const cacheKey = `email_bl:${domain}`;
        const cached = await this.redisService.get(cacheKey);
        if (cached !== null) return cached === '1';

        const entry = await this.emailBlacklistRepository.findOne({
            where: { domain, isActive: true },
        });

        const isBlacklisted = !!entry;
        await this.redisService.set(cacheKey, isBlacklisted ? '1' : '0', 86400); // 24h cache
        return isBlacklisted;
    }

    async addToBlacklist(domain: string, reason: string, adminId: string): Promise<EmailBlacklist> {
        const existing = await this.emailBlacklistRepository.findOne({ where: { domain } });
        if (existing) {
            existing.isActive = true;
            existing.reason = reason;
            return this.emailBlacklistRepository.save(existing);
        }

        const entry = this.emailBlacklistRepository.create({
            domain: domain.toLowerCase(),
            reason,
            addedBy: adminId,
        });

        const saved = await this.emailBlacklistRepository.save(entry);

        // Invalidate cache
        await this.redisService.del(`email_bl:${domain.toLowerCase()}`);

        return saved;
    }

    async removeFromBlacklist(domain: string): Promise<void> {
        await this.emailBlacklistRepository.update({ domain: domain.toLowerCase() }, { isActive: false });
        await this.redisService.del(`email_bl:${domain.toLowerCase()}`);
    }

    async getBlacklist(): Promise<EmailBlacklist[]> {
        return this.emailBlacklistRepository.find({
            where: { isActive: true },
            order: { createdAt: 'DESC' },
        });
    }
}

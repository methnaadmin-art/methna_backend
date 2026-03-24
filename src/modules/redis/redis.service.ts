import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(RedisService.name);
    private client: Redis;
    private isConnected = false;

    // In-memory rate limit fallback when Redis is down
    private readonly memRateLimit = new Map<string, { count: number; expiresAt: number }>();

    // Cache hit/miss counters for monitoring
    private cacheHits = 0;
    private cacheMisses = 0;
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor(private configService: ConfigService) {}

    async onModuleInit() {
        const redisUrl = this.configService.get<string>('redis.url');
        if (!redisUrl) {
            this.logger.warn('REDIS_URL not set — using in-memory fallback only');
            return;
        }

        this.client = new Redis(redisUrl, {
            maxRetriesPerRequest: 3,
            retryStrategy: (times) => Math.min(times * 200, 5000),
            enableReadyCheck: true,
            lazyConnect: false,
            tls: redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined,
        });

        this.client.on('connect', () => {
            this.isConnected = true;
            this.logger.log('Redis connected (ioredis TCP)');
        });
        this.client.on('error', (err) => {
            this.isConnected = false;
            this.logger.error(`Redis error: ${err.message}`);
        });
        this.client.on('close', () => {
            this.isConnected = false;
            this.logger.warn('Redis connection closed');
        });
        this.client.on('reconnecting', () => {
            this.logger.log('Redis reconnecting...');
        });

        // Periodic cleanup of in-memory rate limit map (every 60s)
        this.cleanupInterval = setInterval(() => this.cleanupMemRateLimit(), 60_000);
    }

    async onModuleDestroy() {
        if (this.cleanupInterval) clearInterval(this.cleanupInterval);
        if (this.client) {
            await this.client.quit();
            this.logger.log('Redis connection closed gracefully');
        }
    }

    /** Expose the raw ioredis client (for socket.io adapter, etc.) */
    getClient(): Redis {
        return this.client;
    }

    /** Create a duplicate connection (for socket.io pub/sub which needs separate connections) */
    createDuplicate(): Redis {
        return this.client?.duplicate();
    }

    get connected(): boolean {
        return this.isConnected;
    }

    // ─── Core Commands ───────────────────────────────────────

    async get(key: string): Promise<string | null> {
        if (!this.isConnected) return null;
        try {
            return await this.client.get(key);
        } catch (err) {
            this.logger.error(`GET ${key} failed`, err);
            return null;
        }
    }

    async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
        if (!this.isConnected) return;
        try {
            if (ttlSeconds) {
                await this.client.set(key, value, 'EX', ttlSeconds);
            } else {
                await this.client.set(key, value);
            }
        } catch (err) {
            this.logger.error(`SET ${key} failed`, err);
        }
    }

    async del(key: string): Promise<void> {
        if (!this.isConnected) return;
        try {
            await this.client.del(key);
        } catch (err) {
            this.logger.error(`DEL ${key} failed`, err);
        }
    }

    async setJson(key: string, value: any, ttlSeconds?: number): Promise<void> {
        await this.set(key, JSON.stringify(value), ttlSeconds);
    }

    async getJson<T>(key: string): Promise<T | null> {
        const value = await this.get(key);
        if (!value) {
            this.cacheMisses++;
            return null;
        }
        try {
            this.cacheHits++;
            return JSON.parse(value) as T;
        } catch {
            return null;
        }
    }

    async exists(key: string): Promise<boolean> {
        if (!this.isConnected) return false;
        try {
            return (await this.client.exists(key)) === 1;
        } catch {
            return false;
        }
    }

    async expire(key: string, ttlSeconds: number): Promise<void> {
        if (!this.isConnected) return;
        try {
            await this.client.expire(key, ttlSeconds);
        } catch {}
    }

    async incr(key: string): Promise<number> {
        if (!this.isConnected) return 1;
        try {
            return await this.client.incr(key);
        } catch {
            return 1;
        }
    }

    async sadd(key: string, ...members: string[]): Promise<void> {
        if (!this.isConnected) return;
        try {
            await this.client.sadd(key, ...members);
        } catch {}
    }

    async srem(key: string, ...members: string[]): Promise<void> {
        if (!this.isConnected) return;
        try {
            await this.client.srem(key, ...members);
        } catch {}
    }

    async smembers(key: string): Promise<string[]> {
        if (!this.isConnected) return [];
        try {
            return await this.client.smembers(key);
        } catch {
            return [];
        }
    }

    async sismember(key: string, member: string): Promise<boolean> {
        if (!this.isConnected) return false;
        try {
            return (await this.client.sismember(key, member)) === 1;
        } catch {
            return false;
        }
    }

    // ─── Online Presence ─────────────────────────────────────

    async setUserOnline(userId: string): Promise<void> {
        await this.sadd('online_users', userId);
        await this.set(`user:${userId}:last_seen`, new Date().toISOString(), 300);
    }

    async setUserOffline(userId: string): Promise<void> {
        await this.srem('online_users', userId);
        await this.set(`user:${userId}:last_seen`, new Date().toISOString());
    }

    async isUserOnline(userId: string): Promise<boolean> {
        return this.sismember('online_users', userId);
    }

    async getOnlineUsers(): Promise<string[]> {
        return this.smembers('online_users');
    }

    // ─── Rate Limiting (Redis + in-memory fallback) ──────────

    async checkRateLimit(
        key: string,
        limit: number,
        windowSeconds: number,
    ): Promise<boolean> {
        const fullKey = `ratelimit:${key}`;

        // Try Redis first
        if (this.isConnected) {
            try {
                const current = await this.client.incr(fullKey);
                if (current === 1) {
                    await this.client.expire(fullKey, windowSeconds);
                }
                return current <= limit;
            } catch {
                // Fall through to in-memory
            }
        }

        // In-memory fallback — rate limiting must never fail open
        const now = Date.now();
        const entry = this.memRateLimit.get(fullKey);
        if (!entry || entry.expiresAt < now) {
            this.memRateLimit.set(fullKey, { count: 1, expiresAt: now + windowSeconds * 1000 });
            return true;
        }
        entry.count++;
        return entry.count <= limit;
    }

    // ─── Token Blacklist (for logout / session revocation) ───

    async blacklistToken(jti: string, ttlSeconds: number): Promise<void> {
        await this.set(`blacklist:${jti}`, '1', ttlSeconds);
    }

    async isTokenBlacklisted(jti: string): Promise<boolean> {
        const result = await this.get(`blacklist:${jti}`);
        return result === '1';
    }

    // ─── Token Family (refresh token rotation detection) ─────

    async storeTokenFamily(userId: string, familyId: string, ttlSeconds: number): Promise<void> {
        await this.set(`tokenfamily:${userId}:${familyId}`, 'valid', ttlSeconds);
    }

    async isTokenFamilyValid(userId: string, familyId: string): Promise<boolean> {
        const result = await this.get(`tokenfamily:${userId}:${familyId}`);
        return result === 'valid';
    }

    async invalidateTokenFamily(userId: string, familyId: string): Promise<void> {
        await this.set(`tokenfamily:${userId}:${familyId}`, 'revoked', 86400);
    }

    async invalidateAllUserSessions(userId: string): Promise<void> {
        // Set a global revocation timestamp — any token issued before this is invalid
        await this.set(`user_revoked_at:${userId}`, Date.now().toString(), 86400 * 30);
    }

    async getUserRevokedAt(userId: string): Promise<number | null> {
        const val = await this.get(`user_revoked_at:${userId}`);
        return val ? parseInt(val, 10) : null;
    }

    // ─── Audit Log (append to Redis list, capped) ────────────

    async appendAuditLog(entry: Record<string, any>): Promise<void> {
        if (!this.isConnected) return;
        try {
            const key = `audit:${entry.type || 'general'}`;
            await this.client.lpush(key, JSON.stringify({ ...entry, timestamp: new Date().toISOString() }));
            await this.client.ltrim(key, 0, 9999); // Keep last 10,000 entries per type
        } catch {}
    }

    async getAuditLogs(type: string, count = 100): Promise<any[]> {
        if (!this.isConnected) return [];
        try {
            const entries = await this.client.lrange(`audit:${type}`, 0, count - 1);
            return entries.map(e => JSON.parse(e));
        } catch {
            return [];
        }
    }

    // ─── Stats (for monitoring endpoint) ──────────────────────

    getCacheStats(): { hits: number; misses: number; hitRate: string; connected: boolean } {
        const total = this.cacheHits + this.cacheMisses;
        return {
            hits: this.cacheHits,
            misses: this.cacheMisses,
            hitRate: total > 0 ? `${((this.cacheHits / total) * 100).toFixed(1)}%` : '0%',
            connected: this.isConnected,
        };
    }

    resetCacheStats(): void {
        this.cacheHits = 0;
        this.cacheMisses = 0;
    }

    // ─── Periodic cleanup for in-memory rate limit map ───────

    cleanupMemRateLimit(): void {
        const now = Date.now();
        for (const [key, entry] of this.memRateLimit) {
            if (entry.expiresAt < now) {
                this.memRateLimit.delete(key);
            }
        }
    }
}

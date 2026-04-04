import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Real Redis service using ioredis.
 * Connects to Redis Labs via REDIS_URL env var.
 * Keeps the exact same public API so all 23+ consumer files need ZERO changes.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
    private readonly logger = new Logger(RedisService.name);
    private readonly client: Redis;
    private _connected = false;

    // ─── Stats ───────────────────────────────────────────────
    private cacheHits = 0;
    private cacheMisses = 0;

    constructor() {
        const redisUrl = process.env.REDIS_URL;

        if (!redisUrl) {
            this.logger.warn('REDIS_URL not set — Redis will not be available');
            this.client = null as any;
            return;
        }

        this.client = new Redis(redisUrl, {
            maxRetriesPerRequest: 3,
            retryStrategy: (times) => {
                if (times > 10) {
                    this.logger.error('Redis: max retries reached, giving up');
                    return null; // stop retrying
                }
                return Math.min(times * 200, 5000);
            },
            reconnectOnError: (err) => {
                this.logger.warn(`Redis reconnectOnError: ${err.message}`);
                return true;
            },
            enableReadyCheck: true,
            lazyConnect: false,
        });

        this.client.on('connect', () => {
            this._connected = true;
            this.logger.log('✅ Redis connected successfully');
        });

        this.client.on('ready', () => {
            this.logger.log('✅ Redis ready to accept commands');
        });

        this.client.on('error', (err) => {
            this._connected = false;
            this.logger.error(`Redis error: ${err.message}`);
        });

        this.client.on('close', () => {
            this._connected = false;
            this.logger.warn('Redis connection closed');
        });
    }

    async onModuleDestroy() {
        if (this.client) {
            await this.client.quit().catch(() => {});
            this.logger.log('Redis disconnected');
        }
    }

    getClient(): Redis | null {
        return this.client || null;
    }

    createDuplicate(): Redis | null {
        return this.client ? this.client.duplicate() : null;
    }

    get connected(): boolean {
        return this._connected;
    }

    // ─── Helpers ──────────────────────────────────────────────

    private isReady(): boolean {
        return this.client && this._connected;
    }

    // ─── Core Commands ───────────────────────────────────────

    async get(key: string): Promise<string | null> {
        if (!this.isReady()) return null;
        try {
            return await this.client.get(key);
        } catch (e) {
            this.logger.warn(`Redis GET error: ${e.message}`);
            return null;
        }
    }

    async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
        if (!this.isReady()) return;
        try {
            if (ttlSeconds && ttlSeconds > 0) {
                await this.client.setex(key, ttlSeconds, value);
            } else {
                await this.client.set(key, value);
            }
        } catch (e) {
            this.logger.warn(`Redis SET error: ${e.message}`);
        }
    }

    async del(key: string): Promise<void> {
        if (!this.isReady()) return;
        try {
            await this.client.del(key);
        } catch (e) {
            this.logger.warn(`Redis DEL error: ${e.message}`);
        }
    }

    async delByPattern(pattern: string): Promise<void> {
        if (!this.isReady()) return;
        try {
            const keys = await this.client.keys(pattern);
            if (keys.length > 0) {
                await this.client.del(...keys);
            }
        } catch (e) {
            this.logger.warn(`Redis DEL pattern error: ${e.message}`);
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
        if (!this.isReady()) return false;
        try {
            const result = await this.client.exists(key);
            return result === 1;
        } catch {
            return false;
        }
    }

    async expire(key: string, ttlSeconds: number): Promise<void> {
        if (!this.isReady()) return;
        try {
            await this.client.expire(key, ttlSeconds);
        } catch (e) {
            this.logger.warn(`Redis EXPIRE error: ${e.message}`);
        }
    }

    async incr(key: string): Promise<number> {
        if (!this.isReady()) return 1;
        try {
            return await this.client.incr(key);
        } catch {
            return 1;
        }
    }

    // ─── Sets ────────────────────────────────────────────────

    async sadd(key: string, ...members: string[]): Promise<void> {
        if (!this.isReady() || members.length === 0) return;
        try {
            await this.client.sadd(key, ...members);
        } catch (e) {
            this.logger.warn(`Redis SADD error: ${e.message}`);
        }
    }

    async srem(key: string, ...members: string[]): Promise<void> {
        if (!this.isReady() || members.length === 0) return;
        try {
            await this.client.srem(key, ...members);
        } catch (e) {
            this.logger.warn(`Redis SREM error: ${e.message}`);
        }
    }

    async smembers(key: string): Promise<string[]> {
        if (!this.isReady()) return [];
        try {
            return await this.client.smembers(key);
        } catch {
            return [];
        }
    }

    async sismember(key: string, member: string): Promise<boolean> {
        if (!this.isReady()) return false;
        try {
            const result = await this.client.sismember(key, member);
            return result === 1;
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

    // ─── Rate Limiting ───────────────────────────────────────

    async checkRateLimit(
        key: string,
        limit: number,
        windowSeconds: number,
    ): Promise<boolean> {
        if (!this.isReady()) return true; // Allow if Redis is down
        const fullKey = `ratelimit:${key}`;
        try {
            const current = await this.client.incr(fullKey);
            if (current === 1) {
                await this.client.expire(fullKey, windowSeconds);
            }
            return current <= limit;
        } catch {
            return true; // Allow on error
        }
    }

    // ─── Token Blacklist ─────────────────────────────────────

    async blacklistToken(jti: string, ttlSeconds: number): Promise<void> {
        await this.set(`blacklist:${jti}`, '1', ttlSeconds);
    }

    async isTokenBlacklisted(jti: string): Promise<boolean> {
        const result = await this.get(`blacklist:${jti}`);
        return result === '1';
    }

    // ─── Token Family ────────────────────────────────────────

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
        await this.set(`user_revoked_at:${userId}`, Date.now().toString(), 86400 * 30);
    }

    async getUserRevokedAt(userId: string): Promise<number | null> {
        const val = await this.get(`user_revoked_at:${userId}`);
        return val ? parseInt(val, 10) : null;
    }

    // ─── Audit Log ───────────────────────────────────────────

    async appendAuditLog(entry: Record<string, any>): Promise<void> {
        if (!this.isReady()) return;
        const key = `audit:${entry.type || 'general'}`;
        try {
            await this.client.lpush(key, JSON.stringify({ ...entry, timestamp: new Date().toISOString() }));
            await this.client.ltrim(key, 0, 9999); // Keep last 10,000 entries
        } catch (e) {
            this.logger.warn(`Redis LPUSH error: ${e.message}`);
        }
    }

    async getAuditLogs(type: string, count = 100): Promise<any[]> {
        if (!this.isReady()) return [];
        try {
            const list = await this.client.lrange(`audit:${type}`, 0, count - 1);
            return list.map(e => {
                try { return JSON.parse(e); } catch { return null; }
            }).filter(Boolean);
        } catch {
            return [];
        }
    }

    // ─── Stats ───────────────────────────────────────────────

    getCacheStats(): { hits: number; misses: number; hitRate: string; connected: boolean } {
        const total = this.cacheHits + this.cacheMisses;
        return {
            hits: this.cacheHits,
            misses: this.cacheMisses,
            hitRate: total > 0 ? `${((this.cacheHits / total) * 100).toFixed(1)}%` : '0%',
            connected: this._connected,
        };
    }

    resetCacheStats(): void {
        this.cacheHits = 0;
        this.cacheMisses = 0;
    }
}

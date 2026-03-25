import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

/**
 * In-Memory replacement for Redis.
 * Keeps the exact same public API so all 23+ consumer files need ZERO changes.
 * All data lives in Maps — works without any external dependency.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
    private readonly logger = new Logger(RedisService.name);

    // ─── Core KV store ───────────────────────────────────────
    private readonly store = new Map<string, { value: string; expiresAt: number | null }>();

    // ─── Sets ────────────────────────────────────────────────
    private readonly sets = new Map<string, Set<string>>();

    // ─── Lists (for audit logs) ──────────────────────────────
    private readonly lists = new Map<string, string[]>();

    // ─── Rate limiting ───────────────────────────────────────
    private readonly rateLimits = new Map<string, { count: number; expiresAt: number }>();

    // ─── Stats ───────────────────────────────────────────────
    private cacheHits = 0;
    private cacheMisses = 0;
    private cleanupInterval: ReturnType<typeof setInterval> | null = null;

    constructor() {
        // Periodic cleanup of expired keys every 30s
        this.cleanupInterval = setInterval(() => this.cleanup(), 30_000);
        this.logger.log('In-memory cache initialized (Redis-free mode)');
    }

    onModuleDestroy() {
        if (this.cleanupInterval) clearInterval(this.cleanupInterval);
        this.logger.log('In-memory cache destroyed');
    }

    /** No real Redis client — return null safely */
    getClient(): any {
        return null;
    }

    /** No real Redis client — return null safely */
    createDuplicate(): any {
        return null;
    }

    get connected(): boolean {
        return true; // In-memory is always "connected"
    }

    // ─── Core Commands ───────────────────────────────────────

    async get(key: string): Promise<string | null> {
        const entry = this.store.get(key);
        if (!entry) return null;
        if (entry.expiresAt && Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return null;
        }
        return entry.value;
    }

    async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
        this.store.set(key, {
            value,
            expiresAt: ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
        });
    }

    async del(key: string): Promise<void> {
        this.store.delete(key);
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
        const val = await this.get(key);
        return val !== null;
    }

    async expire(key: string, ttlSeconds: number): Promise<void> {
        const entry = this.store.get(key);
        if (entry) {
            entry.expiresAt = Date.now() + ttlSeconds * 1000;
        }
    }

    async incr(key: string): Promise<number> {
        const current = await this.get(key);
        const newVal = (parseInt(current || '0', 10) || 0) + 1;
        // Preserve existing TTL
        const entry = this.store.get(key);
        await this.set(key, newVal.toString());
        if (entry?.expiresAt) {
            const remaining = Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
            if (remaining > 0) {
                this.store.get(key)!.expiresAt = entry.expiresAt;
            }
        }
        return newVal;
    }

    // ─── Sets ────────────────────────────────────────────────

    async sadd(key: string, ...members: string[]): Promise<void> {
        if (!this.sets.has(key)) this.sets.set(key, new Set());
        const set = this.sets.get(key)!;
        for (const m of members) set.add(m);
    }

    async srem(key: string, ...members: string[]): Promise<void> {
        const set = this.sets.get(key);
        if (!set) return;
        for (const m of members) set.delete(m);
    }

    async smembers(key: string): Promise<string[]> {
        const set = this.sets.get(key);
        return set ? Array.from(set) : [];
    }

    async sismember(key: string, member: string): Promise<boolean> {
        const set = this.sets.get(key);
        return set ? set.has(member) : false;
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
        const fullKey = `ratelimit:${key}`;
        const now = Date.now();
        const entry = this.rateLimits.get(fullKey);

        if (!entry || entry.expiresAt < now) {
            this.rateLimits.set(fullKey, { count: 1, expiresAt: now + windowSeconds * 1000 });
            return true;
        }
        entry.count++;
        return entry.count <= limit;
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
        const key = `audit:${entry.type || 'general'}`;
        if (!this.lists.has(key)) this.lists.set(key, []);
        const list = this.lists.get(key)!;
        list.unshift(JSON.stringify({ ...entry, timestamp: new Date().toISOString() }));
        // Keep last 10,000 entries per type
        if (list.length > 10_000) list.length = 10_000;
    }

    async getAuditLogs(type: string, count = 100): Promise<any[]> {
        const list = this.lists.get(`audit:${type}`);
        if (!list) return [];
        return list.slice(0, count).map(e => {
            try { return JSON.parse(e); } catch { return null; }
        }).filter(Boolean);
    }

    // ─── Stats ───────────────────────────────────────────────

    getCacheStats(): { hits: number; misses: number; hitRate: string; connected: boolean } {
        const total = this.cacheHits + this.cacheMisses;
        return {
            hits: this.cacheHits,
            misses: this.cacheMisses,
            hitRate: total > 0 ? `${((this.cacheHits / total) * 100).toFixed(1)}%` : '0%',
            connected: true,
        };
    }

    resetCacheStats(): void {
        this.cacheHits = 0;
        this.cacheMisses = 0;
    }

    // ─── Cleanup ─────────────────────────────────────────────

    private cleanup(): void {
        const now = Date.now();
        // Clean expired KV entries
        for (const [key, entry] of this.store) {
            if (entry.expiresAt && entry.expiresAt < now) {
                this.store.delete(key);
            }
        }
        // Clean expired rate limits
        for (const [key, entry] of this.rateLimits) {
            if (entry.expiresAt < now) {
                this.rateLimits.delete(key);
            }
        }
    }
}

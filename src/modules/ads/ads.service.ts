import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, LessThan } from 'typeorm';
import { Ad, AdPlacement, AdStatus } from '../../database/entities/ad.entity';
import { RedisService } from '../redis/redis.service';

export interface FeedItem {
    type: 'user' | 'ad';
    data: any;
}

@Injectable()
export class AdsService {
    private readonly logger = new Logger(AdsService.name);

    constructor(
        @InjectRepository(Ad)
        private readonly adRepository: Repository<Ad>,
        private readonly redisService: RedisService,
    ) { }

    /**
     * Get active feed ads for insertion into the swipe feed.
     * Returns ads that are:
     * - status = ACTIVE
     * - placement = FEED
     * - currently within their date range (if set)
     */
    async getFeedAds(limit: number = 5): Promise<Ad[]> {
        const cacheKey = 'ads:feed';
        const cached = await this.redisService.getJson<Ad[]>(cacheKey);
        if (cached && cached.length > 0) return cached.slice(0, limit);

        const now = new Date();
        const ads = await this.adRepository.find({
            where: {
                status: AdStatus.ACTIVE,
                placement: AdPlacement.FEED,
            },
            order: { weight: 'DESC', createdAt: 'DESC' },
        });

        // Filter by date range in JS (some may have null start/end)
        const active = ads.filter(ad => {
            const started = !ad.startDate || new Date(ad.startDate) <= now;
            const notExpired = !ad.endDate || new Date(ad.endDate) > now;
            return started && notExpired;
        });

        await this.redisService.setJson(cacheKey, active, 300); // 5 min cache
        return active.slice(0, limit);
    }

    /**
     * Inject ads into a user feed at regular intervals.
     * Every `interval` user cards, insert one ad.
     * Ads are weighted-random selected from the active pool.
     */
    async injectAdsIntoFeed(
        userItems: any[],
        interval: number = 5,
    ): Promise<FeedItem[]> {
        if (userItems.length === 0) return [];

        const ads = await this.getFeedAds(10);
        if (ads.length === 0) {
            return userItems.map(item => ({ type: 'user' as const, data: item }));
        }

        const result: FeedItem[] = [];
        let adIndex = 0;

        for (let i = 0; i < userItems.length; i++) {
            result.push({ type: 'user', data: userItems[i] });

            // Insert an ad after every `interval` user cards
            if ((i + 1) % interval === 0 && adIndex < ads.length) {
                const ad = this.weightedRandomPick(ads);
                if (ad) {
                    result.push({ type: 'ad', data: this.formatAdForFeed(ad) });
                    adIndex++;
                }
            }
        }

        return result;
    }

    /**
     * Return ads as a separate list for the client to inject.
     * Alternative approach: client handles insertion logic.
     */
    async getFeedAdCards(limit: number = 5): Promise<FeedItem[]> {
        const ads = await this.getFeedAds(limit);
        return ads.map(ad => ({ type: 'ad' as const, data: this.formatAdForFeed(ad) }));
    }

    /**
     * Track an ad impression (increment counter).
     */
    async trackImpression(adId: string): Promise<void> {
        await this.adRepository.increment({ id: adId }, 'impressions', 1);
    }

    /**
     * Track an ad click (increment counter).
     */
    async trackClick(adId: string): Promise<void> {
        await this.adRepository.increment({ id: adId }, 'clicks', 1);
    }

    /**
     * Format an ad entity into a card shape that matches user cards.
     */
    private formatAdForFeed(ad: Ad) {
        return {
            id: ad.id,
            title: ad.title,
            description: ad.description,
            imageUrl: ad.imageUrl,
            link: ad.buttonLink,
            buttonText: ad.buttonText,
            isAd: true,
        };
    }

    /**
     * Weighted random pick from ads array.
     * Higher weight = more likely to be picked.
     */
    private weightedRandomPick(ads: Ad[]): Ad | null {
        if (ads.length === 0) return null;
        const totalWeight = ads.reduce((sum, ad) => sum + (ad.weight || 1), 0);
        let random = Math.random() * totalWeight;
        for (const ad of ads) {
            random -= ad.weight || 1;
            if (random <= 0) return ad;
        }
        return ads[0];
    }
}

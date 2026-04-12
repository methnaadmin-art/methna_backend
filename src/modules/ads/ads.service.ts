import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ad, AdPlacement, AdStatus } from '../../database/entities/ad.entity';
import { Profile } from '../../database/entities/profile.entity';
import { RedisService } from '../redis/redis.service';
import { PlansService } from '../plans/plans.service';

export interface FeedItem {
    type: 'user' | 'ad';
    data: any;
}

export interface FeedAdCard {
    id: string;
    title: string;
    description: string | null;
    imageUrl: string | null;
    link: string | null;
    buttonLink: string | null;
    buttonText: string | null;
    showEveryNUsers: number;
    isAd: boolean;
}

export interface FeedAdsResponse {
    ads: FeedAdCard[];
    showEveryNUsers: number;
}

@Injectable()
export class AdsService {
    private readonly logger = new Logger(AdsService.name);

    constructor(
        @InjectRepository(Ad)
        private readonly adRepository: Repository<Ad>,
        @InjectRepository(Profile)
        private readonly profileRepository: Repository<Profile>,
        private readonly redisService: RedisService,
        private readonly plansService: PlansService,
    ) { }

    async getFeedAds(userId: string, limit: number = 5): Promise<Ad[]> {
        const { plan, entitlements } = await this.plansService.resolveUserEntitlements(userId);
        if (entitlements.hideAds) return [];

        const profile = await this.profileRepository.findOne({ where: { userId } });
        const cacheKey = `ads:feed:${userId}:${plan.code}:${limit}`;
        const cached = await this.redisService.getJson<Ad[]>(cacheKey);
        if (cached) return cached.slice(0, limit);

        const now = new Date();
        const ads = await this.adRepository.find({
            where: {
                status: AdStatus.ACTIVE,
                placement: AdPlacement.FEED,
            },
            order: { weight: 'DESC', createdAt: 'DESC' },
        });

        const active = ads.filter(ad => {
            const started = !ad.startDate || new Date(ad.startDate) <= now;
            const notExpired = !ad.endDate || new Date(ad.endDate) > now;
            return started &&
                notExpired &&
                this.matchesTextTarget(ad.targetGender, profile?.gender) &&
                this.matchesTextTarget(ad.targetCountry, profile?.country) &&
                this.matchesTextTarget(ad.targetCity, profile?.city) &&
                this.matchesPlanTarget(ad.targetPlan, plan.code);
        });

        await this.redisService.setJson(cacheKey, active, 300);
        return active.slice(0, limit);
    }

    async injectAdsIntoFeed(
        userId: string,
        userItems: any[],
        interval?: number,
    ): Promise<FeedItem[]> {
        if (userItems.length === 0) return [];

        const ads = await this.getFeedAds(userId, 10);
        if (ads.length === 0) {
            return userItems.map(item => ({ type: 'user' as const, data: item }));
        }

        const showEveryNUsers = Math.max(1, interval || ads[0]?.showEveryNUsers || 4);
        const result: FeedItem[] = [];
        let adIndex = 0;

        for (let i = 0; i < userItems.length; i++) {
            result.push({ type: 'user', data: userItems[i] });
            if ((i + 1) % showEveryNUsers === 0 && adIndex < ads.length) {
                const ad = this.weightedRandomPick(ads);
                if (ad) {
                    result.push({ type: 'ad', data: this.formatAdForFeed(ad) });
                    adIndex++;
                }
            }
        }

        return result;
    }

    async getFeedAdCards(userId: string, limit: number = 5): Promise<FeedAdsResponse> {
        const ads = await this.getFeedAds(userId, limit);
        return {
            ads: ads.map(ad => this.formatAdForFeed(ad)),
            showEveryNUsers: Math.max(1, ads[0]?.showEveryNUsers || 4),
        };
    }

    async trackImpression(adId: string): Promise<void> {
        await this.adRepository.increment({ id: adId }, 'impressions', 1);
    }

    async trackClick(adId: string): Promise<void> {
        await this.adRepository.increment({ id: adId }, 'clicks', 1);
    }

    private formatAdForFeed(ad: Ad): FeedAdCard {
        return {
            id: ad.id,
            title: ad.title,
            description: ad.description,
            imageUrl: ad.imageUrl,
            link: ad.buttonLink,
            buttonLink: ad.buttonLink,
            buttonText: ad.buttonText,
            showEveryNUsers: Math.max(1, ad.showEveryNUsers || 4),
            isAd: true,
        };
    }

    private matchesTextTarget(target: string | null | undefined, actual: string | null | undefined): boolean {
        const normalizedTarget = (target || '').trim().toLowerCase();
        if (!normalizedTarget || normalizedTarget === 'all') return true;
        return (actual || '').trim().toLowerCase() === normalizedTarget;
    }

    private matchesPlanTarget(target: string | null | undefined, planCode: string): boolean {
        const normalizedTarget = (target || '').trim().toLowerCase();
        if (!normalizedTarget || normalizedTarget === 'all') return true;
        const normalizedPlan = (planCode || 'free').trim().toLowerCase();
        if (normalizedTarget === 'premium') return normalizedPlan !== 'free';
        return normalizedTarget === normalizedPlan;
    }

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

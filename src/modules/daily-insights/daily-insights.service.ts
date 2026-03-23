import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, LessThanOrEqual } from 'typeorm';
import { DailyInsight } from '../../database/entities/daily-insight.entity';

@Injectable()
export class DailyInsightsService {
    constructor(
        @InjectRepository(DailyInsight)
        private readonly insightRepository: Repository<DailyInsight>,
    ) { }

    // ─── Public: Get today's insight ─────────────────────────
    async getTodayInsight(): Promise<DailyInsight> {
        const today = new Date().toISOString().split('T')[0];

        // 1. Check for a scheduled insight for today
        const scheduled = await this.insightRepository.findOne({
            where: { scheduledDate: new Date(today), isActive: true },
        });
        if (scheduled) {
            scheduled.displayCount++;
            await this.insightRepository.save(scheduled);
            return scheduled;
        }

        // 2. Pick a random active insight (not scheduled for a specific date)
        const count = await this.insightRepository.count({
            where: { isActive: true, scheduledDate: IsNull() },
        });
        if (count === 0) {
            // Fallback: any active insight
            const any = await this.insightRepository.findOne({ where: { isActive: true } });
            if (any) return any;
            // Ultimate fallback
            return {
                id: 'default',
                content: 'And among His Signs is that He created for you mates from among yourselves, that you may dwell in tranquility with them.',
                author: 'Quran 30:21',
                category: 'marriage',
                isActive: true,
                displayCount: 0,
                createdAt: new Date(),
            } as unknown as DailyInsight;
        }

        // Use day-of-year as a stable daily seed
        const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
        const offset = dayOfYear % count;

        const insight = await this.insightRepository
            .createQueryBuilder('insight')
            .where('insight.isActive = :active', { active: true })
            .andWhere('insight.scheduledDate IS NULL')
            .orderBy('insight.createdAt', 'ASC')
            .skip(offset)
            .take(1)
            .getOne();

        if (insight) {
            insight.displayCount++;
            await this.insightRepository.save(insight);
            return insight;
        }

        const fallback = await this.insightRepository.findOne({ where: { isActive: true } });
        return fallback!;
    }

    // ─── Admin: CRUD ─────────────────────────────────────────

    async create(data: Partial<DailyInsight>): Promise<DailyInsight> {
        const insight = this.insightRepository.create(data);
        return this.insightRepository.save(insight);
    }

    async findAll(page = 1, limit = 20) {
        const [items, total] = await this.insightRepository.findAndCount({
            order: { createdAt: 'DESC' },
            skip: (page - 1) * limit,
            take: limit,
        });
        return { items, total, page, limit };
    }

    async update(id: string, data: Partial<DailyInsight>): Promise<DailyInsight> {
        const insight = await this.insightRepository.findOne({ where: { id } });
        if (!insight) throw new NotFoundException('Insight not found');
        Object.assign(insight, data);
        return this.insightRepository.save(insight);
    }

    async remove(id: string): Promise<void> {
        const result = await this.insightRepository.delete(id);
        if (result.affected === 0) throw new NotFoundException('Insight not found');
    }

    async seed(): Promise<number> {
        const count = await this.insightRepository.count();
        if (count > 0) return count;

        const seeds: Partial<DailyInsight>[] = [
            { content: 'And among His Signs is that He created for you mates from among yourselves, that you may dwell in tranquility with them, and He has put love and mercy between your hearts.', author: 'Quran 30:21', category: 'marriage' },
            { content: 'The best of you are those who are the best to their wives.', author: 'Prophet Muhammad (PBUH)', category: 'marriage' },
            { content: 'When a man marries, he has fulfilled half of his religion, so let him fear Allah regarding the remaining half.', author: 'Prophet Muhammad (PBUH)', category: 'faith' },
            { content: 'Do not lose hope, nor be sad. You will surely be victorious if you are true believers.', author: 'Quran 3:139', category: 'patience' },
            { content: 'Verily, with hardship comes ease.', author: 'Quran 94:6', category: 'patience' },
            { content: 'The strongest among you is the one who controls his anger.', author: 'Prophet Muhammad (PBUH)', category: 'general' },
            { content: 'Whoever believes in Allah and the Last Day, let him speak good or remain silent.', author: 'Prophet Muhammad (PBUH)', category: 'general' },
            { content: 'A good word is charity.', author: 'Prophet Muhammad (PBUH)', category: 'love' },
            { content: 'And lower your wing for the believers who follow you.', author: 'Quran 26:215', category: 'love' },
            { content: 'The believer is not the one who eats his fill while his neighbor goes hungry.', author: 'Prophet Muhammad (PBUH)', category: 'general' },
            { content: 'Make things easy and do not make them difficult, cheer the people up by conveying glad tidings to them and do not repulse them.', author: 'Prophet Muhammad (PBUH)', category: 'general' },
            { content: 'Allah does not look at your appearance or your possessions; but He looks at your heart and your deeds.', author: 'Prophet Muhammad (PBUH)', category: 'faith' },
            { content: 'The most complete of the believers in faith, is the one with the best character among them.', author: 'Prophet Muhammad (PBUH)', category: 'faith' },
            { content: 'Be in this world as if you were a stranger or a traveler along a path.', author: 'Prophet Muhammad (PBUH)', category: 'general' },
            { content: 'Marry those among you who are single, and the righteous among your servants. If they are poor, Allah will enrich them of His bounty.', author: 'Quran 24:32', category: 'marriage' },
        ];

        await this.insightRepository.save(seeds.map(s => this.insightRepository.create(s)));
        return seeds.length;
    }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppContent, ContentType } from '../../database/entities/app-content.entity';
import { Faq } from '../../database/entities/faq.entity';
import { JobVacancy } from '../../database/entities/job-vacancy.entity';
import { Partner } from '../../database/entities/partner.entity';
import { CreateContentDto, UpdateContentDto, CreateFaqDto, UpdateFaqDto, CreateJobDto, UpdateJobDto, CreatePartnerDto, UpdatePartnerDto } from './dto/content.dto';

@Injectable()
export class ContentService {
    constructor(
        @InjectRepository(AppContent)
        private readonly contentRepo: Repository<AppContent>,
        @InjectRepository(Faq)
        private readonly faqRepo: Repository<Faq>,
        @InjectRepository(JobVacancy)
        private readonly jobRepo: Repository<JobVacancy>,
        @InjectRepository(Partner)
        private readonly partnerRepo: Repository<Partner>,
    ) {}

    async getByType(type: string, locale: string = 'en'): Promise<AppContent> {
        const content = await this.contentRepo.findOne({
            where: { type: type as ContentType, locale, isPublished: true },
        });
        if (!content) {
            throw new NotFoundException(`Content not found for type: ${type}, locale: ${locale}`);
        }
        return content;
    }

    async getAll(): Promise<AppContent[]> {
        return this.contentRepo.find({ order: { type: 'ASC', locale: 'ASC' } });
    }

    async create(dto: CreateContentDto): Promise<AppContent> {
        const content = this.contentRepo.create({
            type: dto.type,
            title: dto.title,
            content: dto.content,
            locale: dto.locale || 'en',
            isPublished: dto.isPublished ?? true,
        });
        return this.contentRepo.save(content);
    }

    async update(id: string, dto: UpdateContentDto): Promise<AppContent> {
        const content = await this.contentRepo.findOne({ where: { id } });
        if (!content) {
            throw new NotFoundException('Content not found');
        }
        if (dto.type !== undefined) content.type = dto.type;
        if (dto.title !== undefined) content.title = dto.title;
        if (dto.content !== undefined) content.content = dto.content;
        if (dto.isPublished !== undefined) content.isPublished = dto.isPublished;
        if (dto.locale !== undefined) content.locale = dto.locale;
        return this.contentRepo.save(content);
    }

    async delete(id: string): Promise<void> {
        const result = await this.contentRepo.delete(id);
        if (result.affected === 0) {
            throw new NotFoundException('Content not found');
        }
    }

    // ─── FAQ Methods ─────────────────────────────────────────

    async getFaqs(locale: string = 'en', category?: string): Promise<Faq[]> {
        const where: any = { locale, isPublished: true };
        if (category) where.category = category;
        return this.faqRepo.find({ where, order: { category: 'ASC', order: 'ASC' } });
    }

    async getAllFaqs(): Promise<Faq[]> {
        return this.faqRepo.find({ order: { category: 'ASC', order: 'ASC' } });
    }

    async createFaq(dto: CreateFaqDto): Promise<Faq> {
        const faq = this.faqRepo.create(dto as Partial<Faq>);
        return this.faqRepo.save(faq);
    }

    async updateFaq(id: string, dto: UpdateFaqDto): Promise<Faq> {
        const faq = await this.faqRepo.findOne({ where: { id } });
        if (!faq) throw new NotFoundException('FAQ not found');
        Object.assign(faq, dto);
        return this.faqRepo.save(faq);
    }

    async deleteFaq(id: string): Promise<void> {
        const result = await this.faqRepo.delete(id);
        if (result.affected === 0) throw new NotFoundException('FAQ not found');
    }

    // ─── Job Vacancy Methods ─────────────────────────────────

    async getJobs(locale: string = 'en'): Promise<JobVacancy[]> {
        return this.jobRepo.find({
            where: { isActive: true, locale },
            order: { createdAt: 'DESC' },
        });
    }

    async getAllJobs(): Promise<JobVacancy[]> {
        return this.jobRepo.find({ order: { createdAt: 'DESC' } });
    }

    async createJob(dto: CreateJobDto): Promise<JobVacancy> {
        const job = this.jobRepo.create(dto as Partial<JobVacancy>);
        return this.jobRepo.save(job);
    }

    async updateJob(id: string, dto: UpdateJobDto): Promise<JobVacancy> {
        const job = await this.jobRepo.findOne({ where: { id } });
        if (!job) throw new NotFoundException('Job not found');
        Object.assign(job, dto);
        return this.jobRepo.save(job);
    }

    async deleteJob(id: string): Promise<void> {
        const result = await this.jobRepo.delete(id);
        if (result.affected === 0) throw new NotFoundException('Job not found');
    }

    // ─── Partner Methods ─────────────────────────────────────

    async getPartners(): Promise<Partner[]> {
        return this.partnerRepo.find({
            where: { isActive: true },
            order: { order: 'ASC' },
        });
    }

    async getAllPartners(): Promise<Partner[]> {
        return this.partnerRepo.find({ order: { order: 'ASC' } });
    }

    async createPartner(dto: CreatePartnerDto): Promise<Partner> {
        const partner = this.partnerRepo.create(dto as Partial<Partner>);
        return this.partnerRepo.save(partner);
    }

    async updatePartner(id: string, dto: UpdatePartnerDto): Promise<Partner> {
        const partner = await this.partnerRepo.findOne({ where: { id } });
        if (!partner) throw new NotFoundException('Partner not found');
        Object.assign(partner, dto);
        return this.partnerRepo.save(partner);
    }

    async deletePartner(id: string): Promise<void> {
        const result = await this.partnerRepo.delete(id);
        if (result.affected === 0) throw new NotFoundException('Partner not found');
    }
}

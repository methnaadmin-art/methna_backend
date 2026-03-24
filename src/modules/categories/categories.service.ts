import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Category, CategoryStatus, RuleCondition } from '../../database/entities/category.entity';
import { Profile } from '../../database/entities/profile.entity';
import { User } from '../../database/entities/user.entity';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class CategoriesService {
    private readonly logger = new Logger(CategoriesService.name);

    private static readonly CACHE_KEY_ALL = 'categories:all';
    private static readonly CACHE_KEY_ACTIVE = 'categories:active';
    private static readonly CACHE_TTL = 600; // 10 minutes

    constructor(
        @InjectRepository(Category)
        private readonly categoryRepo: Repository<Category>,
        @InjectRepository(Profile)
        private readonly profileRepo: Repository<Profile>,
        @InjectRepository(User)
        private readonly userRepo: Repository<User>,
        private readonly redisService: RedisService,
    ) {}

    // ─── CRUD ────────────────────────────────────────────────

    async create(dto: CreateCategoryDto): Promise<Category> {
        const category = this.categoryRepo.create(dto);
        const saved = await this.categoryRepo.save(category);
        this.logger.log(`Category created: ${saved.name} (${saved.id})`);
        await this.invalidateCache();
        return saved;
    }

    async findAll(includeInactive = false): Promise<Category[]> {
        const cacheKey = includeInactive ? CategoriesService.CACHE_KEY_ALL : CategoriesService.CACHE_KEY_ACTIVE;
        const cached = await this.redisService.getJson<Category[]>(cacheKey);
        if (cached) return cached;

        const where = includeInactive ? {} : { status: CategoryStatus.ACTIVE };
        const categories = await this.categoryRepo.find({
            where,
            order: { sortOrder: 'ASC', createdAt: 'DESC' },
        });

        await this.redisService.setJson(cacheKey, categories, CategoriesService.CACHE_TTL);
        return categories;
    }

    async findOne(id: string): Promise<Category> {
        const category = await this.categoryRepo.findOne({ where: { id } });
        if (!category) throw new NotFoundException('Category not found');
        return category;
    }

    async update(id: string, dto: UpdateCategoryDto): Promise<Category> {
        const category = await this.findOne(id);
        Object.assign(category, dto);
        const saved = await this.categoryRepo.save(category);
        this.logger.log(`Category updated: ${saved.name} (${saved.id})`);
        await this.invalidateCache();
        return saved;
    }

    async remove(id: string): Promise<void> {
        const category = await this.findOne(id);
        await this.categoryRepo.remove(category);
        this.logger.log(`Category deleted: ${id}`);
        await this.invalidateCache();
    }

    // ─── Users in Category (paginated) ──────────────────────

    async getUsersInCategory(categoryId: string, page = 1, limit = 20) {
        const category = await this.findOne(categoryId);

        const qb = this.categoryRepo
            .createQueryBuilder('cat')
            .relation(Category, 'users')
            .of(category);

        // Use a raw query for pagination since relation queries don't support skip/take
        const userIds = await this.categoryRepo
            .createQueryBuilder('cat')
            .innerJoin('cat.users', 'user')
            .select('user.id')
            .where('cat.id = :categoryId', { categoryId })
            .skip((page - 1) * limit)
            .take(limit)
            .getRawMany();

        const ids = userIds.map((r) => r.user_id);
        if (ids.length === 0) return { users: [], total: category.userCount, page, limit };

        const users = await this.userRepo.find({
            where: { id: In(ids) },
            select: ['id', 'firstName', 'lastName', 'email', 'status', 'selfieVerified', 'createdAt'],
        });

        return {
            users,
            total: category.userCount,
            page,
            limit,
        };
    }

    // ─── RULES ENGINE ────────────────────────────────────────

    /**
     * Evaluate a single user against all active categories
     * and update their category assignments.
     * Called on profile create/update.
     */
    async evaluateUserCategories(userId: string): Promise<string[]> {
        const profile = await this.profileRepo.findOne({ where: { userId } });
        if (!profile) return [];

        const categories = await this.categoryRepo.find({
            where: { status: CategoryStatus.ACTIVE },
        });

        const matchedCategoryIds: string[] = [];

        for (const category of categories) {
            if (!category.rules || category.rules.length === 0) continue;

            const matches = this.evaluateRules(category.rules, profile);
            if (matches) {
                matchedCategoryIds.push(category.id);
            }
        }

        // Sync: remove old assignments, add new ones
        await this.syncUserCategories(userId, matchedCategoryIds);

        this.logger.debug(
            `User ${userId} assigned to ${matchedCategoryIds.length} categories`,
        );

        return matchedCategoryIds;
    }

    /**
     * Re-evaluate ALL users for a specific category.
     * Called when a category's rules change.
     */
    async rebuildCategory(categoryId: string): Promise<number> {
        const category = await this.findOne(categoryId);
        if (!category.rules || category.rules.length === 0) {
            // Clear all users from this category
            await this.clearCategoryUsers(categoryId);
            await this.categoryRepo.update(categoryId, { userCount: 0 });
            return 0;
        }

        // Fetch all profiles in batches
        const batchSize = 500;
        let offset = 0;
        const matchedUserIds: string[] = [];

        while (true) {
            const profiles = await this.profileRepo.find({
                skip: offset,
                take: batchSize,
            });
            if (profiles.length === 0) break;

            for (const profile of profiles) {
                if (this.evaluateRules(category.rules, profile)) {
                    matchedUserIds.push(profile.userId);
                }
            }

            offset += batchSize;
        }

        // Replace all users in this category
        await this.replaceCategoryUsers(categoryId, matchedUserIds);
        await this.categoryRepo.update(categoryId, { userCount: matchedUserIds.length });

        this.logger.log(
            `Category "${category.name}" rebuilt: ${matchedUserIds.length} users matched`,
        );

        return matchedUserIds.length;
    }

    // ─── Rule Evaluation Core ────────────────────────────────

    private evaluateRules(rules: RuleCondition[], profile: Profile): boolean {
        // AND logic: all conditions must match
        return rules.every((rule) => this.evaluateSingleRule(rule, profile));
    }

    private evaluateSingleRule(rule: RuleCondition, profile: Profile): boolean {
        const fieldValue = (profile as any)[rule.field];
        if (fieldValue === undefined || fieldValue === null) return false;

        const { operator, value } = rule;

        switch (operator) {
            case '=':
                return String(fieldValue) === String(value);
            case '!=':
                return String(fieldValue) !== String(value);
            case '>':
                return Number(fieldValue) > Number(value);
            case '<':
                return Number(fieldValue) < Number(value);
            case '>=':
                return Number(fieldValue) >= Number(value);
            case '<=':
                return Number(fieldValue) <= Number(value);
            case 'includes':
                if (Array.isArray(fieldValue)) {
                    return fieldValue.includes(String(value));
                }
                return String(fieldValue).includes(String(value));
            case 'not_includes':
                if (Array.isArray(fieldValue)) {
                    return !fieldValue.includes(String(value));
                }
                return !String(fieldValue).includes(String(value));
            default:
                return false;
        }
    }

    // ─── DB Helpers ──────────────────────────────────────────

    private async syncUserCategories(userId: string, categoryIds: string[]): Promise<void> {
        // Remove user from all categories first
        await this.categoryRepo
            .createQueryBuilder()
            .delete()
            .from('user_categories')
            .where('"userId" = :userId', { userId })
            .execute();

        // Add to matched categories
        if (categoryIds.length > 0) {
            await this.categoryRepo
                .createQueryBuilder()
                .insert()
                .into('user_categories')
                .values(categoryIds.map((categoryId) => ({ categoryId, userId })))
                .orIgnore()
                .execute();
        }

        // Update counts for affected categories
        await this.updateAllCategoryCounts();
    }

    private async clearCategoryUsers(categoryId: string): Promise<void> {
        await this.categoryRepo
            .createQueryBuilder()
            .delete()
            .from('user_categories')
            .where('"categoryId" = :categoryId', { categoryId })
            .execute();
    }

    private async replaceCategoryUsers(categoryId: string, userIds: string[]): Promise<void> {
        await this.clearCategoryUsers(categoryId);
        if (userIds.length > 0) {
            // Insert in batches of 500
            for (let i = 0; i < userIds.length; i += 500) {
                const batch = userIds.slice(i, i + 500);
                await this.categoryRepo
                    .createQueryBuilder()
                    .insert()
                    .into('user_categories')
                    .values(batch.map((userId) => ({ categoryId, userId })))
                    .orIgnore()
                    .execute();
            }
        }
    }

    private async updateAllCategoryCounts(): Promise<void> {
        await this.categoryRepo
            .createQueryBuilder()
            .update(Category)
            .set({
                userCount: () =>
                    `(SELECT COUNT(*) FROM user_categories uc WHERE uc."categoryId" = "Category"."id")`,
            })
            .execute();
        await this.invalidateCache();
    }

    private async invalidateCache(): Promise<void> {
        await this.redisService.del(CategoriesService.CACHE_KEY_ALL);
        await this.redisService.del(CategoriesService.CACHE_KEY_ACTIVE);
    }
}

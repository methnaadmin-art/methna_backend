import {
    Injectable,
    Logger,
    BadRequestException,
    NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
    Repository,
    DataSource,
    MoreThan,
    In,
} from 'typeorm';
import Stripe from 'stripe';
import {
    ConsumableProduct,
    ConsumableType,
    PlatformAvailability,
} from '../../database/entities/consumable-product.entity';
import {
    PurchaseTransaction,
    PurchaseProvider,
    PurchaseStatus,
} from '../../database/entities/purchase-transaction.entity';
import { User } from '../../database/entities/user.entity';
import { Boost, BoostType } from '../../database/entities/boost.entity';
import { RedisService } from '../redis/redis.service';

// ─── DTOs ──────────────────────────────────────────────────

export interface CreateConsumableProductDto {
    code: string;
    title: string;
    description?: string;
    type: ConsumableType;
    quantity: number;
    price: number;
    currency?: string;
    platformAvailability?: PlatformAvailability;
    sortOrder?: number;
    googleProductId?: string;
    androidProductId?: string;
    iosProductId?: string;
    appleProductId?: string;
    stripePriceId?: string;
    stripeProductId?: string;
}

export interface UpdateConsumableProductDto {
    title?: string;
    description?: string;
    quantity?: number;
    price?: number;
    currency?: string;
    platformAvailability?: PlatformAvailability;
    sortOrder?: number;
    googleProductId?: string;
    androidProductId?: string;
    iosProductId?: string;
    appleProductId?: string;
    stripePriceId?: string;
    stripeProductId?: string;
    isActive?: boolean;
    isArchived?: boolean;
}

export interface VerifyConsumablePurchaseDto {
    productId: string; // Google Play product ID or Stripe price ID
    purchaseToken: string;
    platform: 'android' | 'ios' | 'web';
    provider: 'google_play' | 'apple' | 'stripe';
    orderId?: string;
    transactionDate?: string;
}

export interface ConsumeBalanceDto {
    type: 'likes' | 'compliments' | 'boosts';
    quantity?: number; // defaults to 1
    durationMinutes?: number; // for boosts
}

@Injectable()
export class ConsumableService {
    private readonly logger = new Logger(ConsumableService.name);
    private static readonly MAX_DAILY_PURCHASES = 10;
    private stripeClient: Stripe | null | undefined = undefined;
    private static readonly DEFAULT_PRODUCTS: Array<CreateConsumableProductDto> = [
        {
            code: 'methna_likes_50',
            title: '50 likes',
            description: 'Add 50 extra likes to your account.',
            type: ConsumableType.LIKES_PACK,
            quantity: 50,
            price: 2.99,
            currency: 'usd',
            platformAvailability: PlatformAvailability.ALL,
            sortOrder: 10,
            googleProductId: 'methna_likes_50',
            iosProductId: 'methna_likes_50',

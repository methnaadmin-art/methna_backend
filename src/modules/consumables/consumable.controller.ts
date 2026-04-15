import {
    Controller,
    Get,
    Post,
    Body,
    Query,
    Param,
    UseGuards,
    HttpCode,
    Logger,
    ParseIntPipe,
    ParseEnumPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../database/entities/user.entity';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ConsumableService, CreateConsumableProductDto, UpdateConsumableProductDto } from './consumable.service';
import { ConsumableType, PlatformAvailability } from '../../database/entities/consumable-product.entity';

@ApiTags('consumables')
@Controller('consumables')
export class ConsumableController {
    private readonly logger = new Logger(ConsumableController.name);

    constructor(private readonly consumableService: ConsumableService) {}

    // ─── PUBLIC: Get products for mobile ───────────────────

    @Get('products/mobile')
    @ApiOperation({ summary: 'Get active consumable products for mobile app' })
    async getMobileProducts() {
        return this.consumableService.getProducts('mobile');
    }

    // ─── PUBLIC: Get products for web ──────────────────────

    @Get('products/web')
    @ApiOperation({ summary: 'Get active consumable products for web app' })
    async getWebProducts() {
        return this.consumableService.getProducts('web');
    }

    // ─── AUTHENTICATED: Get user balances ───────────────────

    @Get('balances/me')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get current user consumable balances' })
    async getMyBalances(@CurrentUser('sub') userId: string) {
        return this.consumableService.getUserBalances(userId);
    }

    // ─── AUTHENTICATED: Get purchase history ───────────────

    @Get('purchases/me')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get current user consumable purchase history' })
    @ApiQuery({ name: 'page', required: false, type: Number })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    async getMyPurchases(
        @CurrentUser('sub') userId: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.consumableService.getPurchaseHistory(
            userId,
            page ? parseInt(page, 10) : 1,
            limit ? parseInt(limit, 10) : 20,
        );
    }

    // ─── ADMIN: List all products ──────────────────────────

    @Get('admin/products')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Admin: List all consumable products with filters' })
    @ApiQuery({ name: 'type', required: false, enum: ConsumableType })
    @ApiQuery({ name: 'active', required: false, type: Boolean })
    @ApiQuery({ name: 'archived', required: false, type: Boolean })
    @ApiQuery({ name: 'search', required: false, type: String })
    async adminListProducts(
        @Query('type') type?: ConsumableType,
        @Query('active') active?: string,
        @Query('archived') archived?: string,
        @Query('search') search?: string,
    ) {
        return this.consumableService.getAllProducts({
            type,
            active: active !== undefined ? active === 'true' : undefined,
            archived: archived !== undefined ? archived === 'true' : undefined,
            search,
        });
    }

    // ─── ADMIN: Create product ─────────────────────────────

    @Post('admin/products')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Admin: Create a consumable product' })
    async adminCreateProduct(@Body() dto: CreateConsumableProductDto) {
        return this.consumableService.createProduct(dto);
    }

    // ─── ADMIN: Update product ─────────────────────────────

    @Post('admin/products/:id')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Admin: Update a consumable product' })
    async adminUpdateProduct(
        @Param('id') id: string,
        @Body() dto: UpdateConsumableProductDto,
    ) {
        return this.consumableService.updateProduct(id, dto);
    }

    // ─── ADMIN: Archive product ─────────────────────────────

    @Post('admin/products/:id/archive')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    @HttpCode(200)
    @ApiOperation({ summary: 'Admin: Archive a consumable product (preserves purchase history)' })
    async adminArchiveProduct(@Param('id') id: string) {
        return this.consumableService.archiveProduct(id);
    }

    // ─── ADMIN: View user balances ──────────────────────────

    @Get('admin/users/:userId/balances')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Admin: View user consumable balances' })
    async adminGetUserBalances(@Param('userId') userId: string) {
        return this.consumableService.getUserBalances(userId);
    }

    // ─── ADMIN: Adjust user balance ─────────────────────────

    @Post('admin/users/:userId/balances/adjust')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    @HttpCode(200)
    @ApiOperation({ summary: 'Admin: Manually adjust user consumable balance' })
    async adminAdjustBalance(
        @CurrentUser('sub') adminId: string,
        @Param('userId') userId: string,
        @Body() body: { type: 'likes' | 'compliments' | 'boosts'; delta: number; reason: string },
    ) {
        if (!body.type || !['likes', 'compliments', 'boosts'].includes(body.type)) {
            throw new Error('Invalid balance type');
        }
        if (typeof body.delta !== 'number') {
            throw new Error('Delta must be a number');
        }
        if (!body.reason?.trim()) {
            throw new Error('Reason is required for balance adjustments');
        }
        return this.consumableService.adjustBalance(userId, body.type, body.delta, adminId, body.reason);
    }

    // ─── ADMIN: View user purchase history ──────────────────

    @Get('admin/users/:userId/purchases')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Admin: View user consumable purchase history' })
    async adminGetUserPurchases(
        @Param('userId') userId: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return this.consumableService.getPurchaseHistory(
            userId,
            page ? parseInt(page, 10) : 1,
            limit ? parseInt(limit, 10) : 20,
        );
    }
}

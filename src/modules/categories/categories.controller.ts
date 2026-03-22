import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
    HttpCode,
    HttpStatus,
    ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
    constructor(private readonly categoriesService: CategoriesService) {}

    // ─── Public Endpoints ────────────────────────────────────

    @Public()
    @Get()
    @ApiOperation({ summary: 'Get all active categories' })
    @ApiResponse({ status: 200, description: 'List of active categories' })
    async findAll() {
        return this.categoriesService.findAll(false);
    }

    @Public()
    @Get(':id')
    @ApiOperation({ summary: 'Get a single category' })
    @ApiResponse({ status: 200, description: 'Category details' })
    @ApiResponse({ status: 404, description: 'Category not found' })
    async findOne(@Param('id', ParseUUIDPipe) id: string) {
        return this.categoriesService.findOne(id);
    }

    @Public()
    @Get(':id/users')
    @ApiOperation({ summary: 'Get paginated users in a category' })
    @ApiQuery({ name: 'page', required: false, type: Number })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    async getUsersInCategory(
        @Param('id', ParseUUIDPipe) id: string,
        @Query('page') page = 1,
        @Query('limit') limit = 20,
    ) {
        return this.categoriesService.getUsersInCategory(id, +page, +limit);
    }

    // ─── Admin Endpoints ─────────────────────────────────────

    @UseGuards(JwtAuthGuard)
    @Post()
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Create a new category (admin)' })
    @ApiResponse({ status: 201, description: 'Category created' })
    async create(@Body() dto: CreateCategoryDto) {
        return this.categoriesService.create(dto);
    }

    @UseGuards(JwtAuthGuard)
    @Patch(':id')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Update a category (admin)' })
    @ApiResponse({ status: 200, description: 'Category updated' })
    async update(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: UpdateCategoryDto,
    ) {
        return this.categoriesService.update(id, dto);
    }

    @UseGuards(JwtAuthGuard)
    @Delete(':id')
    @ApiBearerAuth()
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Delete a category (admin)' })
    async remove(@Param('id', ParseUUIDPipe) id: string) {
        return this.categoriesService.remove(id);
    }

    @UseGuards(JwtAuthGuard)
    @Post(':id/rebuild')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Rebuild category user assignments based on rules (admin)' })
    @ApiResponse({ status: 200, description: 'Number of matched users' })
    async rebuild(@Param('id', ParseUUIDPipe) id: string) {
        const count = await this.categoriesService.rebuildCategory(id);
        return { message: `Category rebuilt with ${count} users`, userCount: count };
    }

    @UseGuards(JwtAuthGuard)
    @Get('admin/all')
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get all categories including inactive (admin)' })
    async findAllAdmin() {
        return this.categoriesService.findAll(true);
    }
}

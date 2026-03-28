import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Param,
    Body,
    Query,
    UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ContentService } from './content.service';
import { CreateContentDto, UpdateContentDto, CreateFaqDto, UpdateFaqDto, CreateJobDto, UpdateJobDto, CreatePartnerDto, UpdatePartnerDto } from './dto/content.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('content')
@Controller('content')
export class ContentController {
    constructor(private readonly contentService: ContentService) {}


    // Admin endpoints
    @Get()
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get all content (admin)' })
    async getAll() {
        return this.contentService.getAll();
    }

    @Post()
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Create content (admin)' })
    async create(@Body() dto: CreateContentDto) {
        return this.contentService.create(dto);
    }

    @Patch(':id')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Update content (admin)' })
    async update(@Param('id') id: string, @Body() dto: UpdateContentDto) {
        return this.contentService.update(id, dto);
    }

    @Delete(':id')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Delete content (admin)' })
    async remove(@Param('id') id: string) {
        return this.contentService.delete(id);
    }

    // ─── FAQ Endpoints ───────────────────────────────────────

    @Get('faqs/list')
    @ApiOperation({ summary: 'Get published FAQs' })
    @ApiQuery({ name: 'locale', required: false })
    @ApiQuery({ name: 'category', required: false })
    async getFaqs(
        @Query('locale') locale?: string,
        @Query('category') category?: string,
    ) {
        return this.contentService.getFaqs(locale || 'en', category);
    }

    @Get('faqs/all')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get all FAQs (admin)' })
    async getAllFaqs() {
        return this.contentService.getAllFaqs();
    }

    @Post('faqs')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Create FAQ (admin)' })
    async createFaq(@Body() dto: CreateFaqDto) {
        return this.contentService.createFaq(dto);
    }

    @Patch('faqs/:id')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Update FAQ (admin)' })
    async updateFaq(@Param('id') id: string, @Body() dto: UpdateFaqDto) {
        return this.contentService.updateFaq(id, dto);
    }

    @Delete('faqs/:id')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Delete FAQ (admin)' })
    async deleteFaq(@Param('id') id: string) {
        return this.contentService.deleteFaq(id);
    }

    // ─── Job Vacancy Endpoints ───────────────────────────────

    @Get('jobs/list')
    @ApiOperation({ summary: 'Get active job vacancies' })
    @ApiQuery({ name: 'locale', required: false })
    async getJobs(@Query('locale') locale?: string) {
        return this.contentService.getJobs(locale || 'en');
    }

    @Get('jobs/all')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get all jobs (admin)' })
    async getAllJobs() {
        return this.contentService.getAllJobs();
    }

    @Post('jobs')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Create job vacancy (admin)' })
    async createJob(@Body() dto: CreateJobDto) {
        return this.contentService.createJob(dto);
    }

    @Patch('jobs/:id')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Update job vacancy (admin)' })
    async updateJob(@Param('id') id: string, @Body() dto: UpdateJobDto) {
        return this.contentService.updateJob(id, dto);
    }

    @Delete('jobs/:id')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Delete job vacancy (admin)' })
    async deleteJob(@Param('id') id: string) {
        return this.contentService.deleteJob(id);
    }

    // ─── Partner Endpoints ───────────────────────────────────

    @Get('partners/list')
    @ApiOperation({ summary: 'Get active partners' })
    async getPartners() {
        return this.contentService.getPartners();
    }

    @Get('partners/all')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Get all partners (admin)' })
    async getAllPartners() {
        return this.contentService.getAllPartners();
    }

    @Post('partners')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Create partner (admin)' })
    async createPartner(@Body() dto: CreatePartnerDto) {
        return this.contentService.createPartner(dto);
    }

    @Patch('partners/:id')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Update partner (admin)' })
    async updatePartner(@Param('id') id: string, @Body() dto: UpdatePartnerDto) {
        return this.contentService.updatePartner(id, dto);
    }

    @Delete('partners/:id')
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Delete partner (admin)' })
    async deletePartner(@Param('id') id: string) {
        return this.contentService.deletePartner(id);
    }

    // Public endpoint — no auth needed (Must be at the bottom to avoid route shadowing)
    @Get(':type')
    @ApiOperation({ summary: 'Get published content by type (terms, privacy, etc.)' })
    @ApiQuery({ name: 'locale', required: false, description: 'Locale code (en, ar)' })
    async getByType(
        @Param('type') type: string,
        @Query('locale') locale?: string,
    ) {
        return this.contentService.getByType(type, locale || 'en');
    }
}

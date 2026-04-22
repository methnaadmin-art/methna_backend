import {
    Controller,
    Post,
    Get,
    Patch,
    Delete,
    Param,
    Body,
    UseGuards,
    UseInterceptors,
    UploadedFile,
    HttpCode,
    HttpStatus,
    BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { PhotosService } from './photos.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

const MAX_PROFILE_PHOTO_BYTES = 12 * 1024 * 1024;
const ALLOWED_PROFILE_PHOTO_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
]);

@ApiTags('photos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('photos')
export class PhotosController {
    constructor(private readonly photosService: PhotosService) { }

    @Post('upload')
    @UseInterceptors(FileInterceptor('photo', {
        storage: memoryStorage(),
        limits: {
            files: 1,
            fileSize: MAX_PROFILE_PHOTO_BYTES,
        },
        fileFilter: (_request, file, callback) => {
            if (ALLOWED_PROFILE_PHOTO_TYPES.has(file.mimetype)) {
                callback(null, true);
                return;
            }

            callback(
                new BadRequestException(
                    'Invalid file type. Only JPEG, PNG, WebP, HEIC, and HEIF are allowed.',
                ),
                false,
            );
        },
    }))
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                photo: { type: 'string', format: 'binary' },
            },
        },
    })
    @ApiOperation({ summary: 'Upload a profile photo' })
    async uploadPhoto(
        @CurrentUser('sub') userId: string,
        @UploadedFile() file: Express.Multer.File,
        @Body('isMain') isMain?: boolean | string,
    ) {
        const isMainBool = String(isMain) === 'true';
        return this.photosService.uploadPhoto(userId, file, isMainBool);
    }

    @Get('me')
    @ApiOperation({ summary: 'Get all my photos' })
    async getMyPhotos(@CurrentUser('sub') userId: string) {
        return this.photosService.getMyPhotos(userId);
    }

    @Patch(':id/main')
    @ApiOperation({ summary: 'Set photo as main profile photo' })
    async setMainPhoto(
        @CurrentUser('sub') userId: string,
        @Param('id') photoId: string,
    ) {
        return this.photosService.setMainPhoto(userId, photoId);
    }

    @Delete(':id')
    @HttpCode(HttpStatus.NO_CONTENT)
    @ApiOperation({ summary: 'Delete a photo' })
    async deletePhoto(
        @CurrentUser('sub') userId: string,
        @Param('id') photoId: string,
    ) {
        return this.photosService.deletePhoto(userId, photoId);
    }
}

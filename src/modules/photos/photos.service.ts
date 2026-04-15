import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
    Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Photo } from '../../database/entities/photo.entity';
import { CloudinaryService } from './cloudinary.service';

const MAX_PHOTOS = 6;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
];

@Injectable()
export class PhotosService {
    private readonly logger = new Logger(PhotosService.name);

    constructor(
        @InjectRepository(Photo)
        private readonly photoRepository: Repository<Photo>,
        private readonly cloudinaryService: CloudinaryService,
    ) { }

    async uploadPhoto(
        userId: string,
        file: Express.Multer.File,
        isMainRequested: boolean = false,
    ): Promise<Record<string, unknown>> {
        // Validate file presence
        if (!file) {
            throw new BadRequestException('No photo file provided');
        }

        // Validate file type
        if (!ALLOWED_TYPES.includes(file.mimetype)) {
            throw new BadRequestException(
                'Invalid file type. Only JPEG, PNG, WebP, HEIC, and HEIF are allowed.',
            );
        }

        // Validate max size
        if (file.size > MAX_UPLOAD_BYTES) {
            throw new BadRequestException('File size must be under 12MB');
        }

        // Check photo limit
        const photoCount = await this.photoRepository.count({
            where: { userId },
        });
        if (photoCount >= MAX_PHOTOS) {
            throw new BadRequestException(`Maximum ${MAX_PHOTOS} photos allowed`);
        }

        try {
            // Upload to Cloudinary
            const result = await this.cloudinaryService.uploadImage(file);

            // Determine if this should be the main photo
            let isMain = isMainRequested || photoCount === 0;

            if (isMain && photoCount > 0) {
                // Unset current main if we're setting a new one
                await this.photoRepository.update(
                    { userId, isMain: true },
                    { isMain: false },
                );
            }

            // Save to DB
            const photo = this.photoRepository.create({
                userId,
                url: result.secure_url,
                publicId: result.public_id,
                isMain,
                order: photoCount,
            });

            const savedPhoto = await this.photoRepository.save(photo);
            return this.withDeliveryUrls(savedPhoto);
        } catch (error) {
            this.logger.error(`Photo upload failed for user ${userId}: ${error.message}`);
            
            // If it's already a NestJS exception (like BadRequest), re-throw it
            if (error.status && error.message) {
                throw error;
            }
            
            throw new BadRequestException(`Photo upload failed: ${error.message}`);
        }
    }

    async getMyPhotos(userId: string): Promise<Array<Record<string, unknown>>> {
        const photos = await this.photoRepository.find({
            where: { userId },
            order: { order: 'ASC' },
        });

        return photos.map((photo) => this.withDeliveryUrls(photo));
    }

    async setMainPhoto(userId: string, photoId: string): Promise<Record<string, unknown>> {
        const photo = await this.photoRepository.findOne({
            where: { id: photoId, userId },
        });
        if (!photo) throw new NotFoundException('Photo not found');

        // Unset current main
        await this.photoRepository.update(
            { userId, isMain: true },
            { isMain: false },
        );

        // Set new main
        photo.isMain = true;
        const saved = await this.photoRepository.save(photo);
        return this.withDeliveryUrls(saved);
    }

    async deletePhoto(userId: string, photoId: string): Promise<void> {
        const photo = await this.photoRepository.findOne({
            where: { id: photoId, userId },
        });
        if (!photo) throw new NotFoundException('Photo not found');

        // Delete from Cloudinary
        await this.cloudinaryService.deleteImage(photo.publicId);

        // Delete from DB
        await this.photoRepository.remove(photo);

        // If deleted photo was main, set next photo as main
        if (photo.isMain) {
            const nextPhoto = await this.photoRepository.findOne({
                where: { userId },
                order: { order: 'ASC' },
            });
            if (nextPhoto) {
                nextPhoto.isMain = true;
                await this.photoRepository.save(nextPhoto);
            }
        }
    }

    async getMainPhoto(userId: string): Promise<Photo | null> {
        return this.photoRepository.findOne({
            where: { userId, isMain: true },
        });
    }

    private withDeliveryUrls(photo: Photo): Record<string, unknown> {
        const urls = CloudinaryService.buildImageUrls(photo.url);

        return {
            ...photo,
            ...urls,
        };
    }
}

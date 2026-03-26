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
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

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
    ): Promise<Photo> {
        // Validate file presence
        if (!file) {
            throw new BadRequestException('No photo file provided');
        }

        // Validate file type
        if (!ALLOWED_TYPES.includes(file.mimetype)) {
            throw new BadRequestException(
                'Invalid file type. Only JPEG, PNG, and WebP are allowed.',
            );
        }

        // Validate max size (5MB)
        if (file.size > 5 * 1024 * 1024) {
            throw new BadRequestException('File size must be under 5MB');
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

            // Determine if first photo (auto-set as main)
            const isMain = photoCount === 0;

            // Save to DB
            const photo = this.photoRepository.create({
                userId,
                url: result.secure_url,
                publicId: result.public_id,
                isMain,
                order: photoCount,
            });

            return await this.photoRepository.save(photo);
        } catch (error) {
            this.logger.error(`Photo upload failed for user ${userId}: ${error.message}`, error.stack);
            
            if (error instanceof BadRequestException) {
                throw error;
            }
            
            throw new Error(`Failed to process photo: ${error.message}`);
        }
    }

    async getMyPhotos(userId: string): Promise<Photo[]> {
        return this.photoRepository.find({
            where: { userId },
            order: { order: 'ASC' },
        });
    }

    async setMainPhoto(userId: string, photoId: string): Promise<Photo> {
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
        return this.photoRepository.save(photo);
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
}

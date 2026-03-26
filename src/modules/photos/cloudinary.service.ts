import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import * as streamifier from 'streamifier';

@Injectable()
export class CloudinaryService {
    private readonly logger = new Logger(CloudinaryService.name);

    constructor(private configService: ConfigService) {
        cloudinary.config({
            cloud_name: this.configService.get<string>('cloudinary.cloudName'),
            api_key: this.configService.get<string>('cloudinary.apiKey'),
            api_secret: this.configService.get<string>('cloudinary.apiSecret'),
        });
        this.logger.log('Cloudinary configured');
    }

    async uploadImage(
        file: Express.Multer.File,
        folder: string = 'wafaa/profiles',
    ): Promise<UploadApiResponse> {
        return new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    folder,
                    resource_type: 'image',
                    transformation: [
                        { width: 800, height: 800, crop: 'limit' },
                        { quality: 'auto:good' },
                        { fetch_format: 'auto' },
                    ],
                },
                (error, result) => {
                    if (error || !result) {
                        this.logger.error(`Cloudinary upload failed: ${error?.message || 'No result'}`, {
                            error,
                            cloudName: this.configService.get('cloudinary.cloudName'),
                            apiKey: this.configService.get('cloudinary.apiKey'),
                        });
                        reject(error || new Error('Upload returned no result'));
                    } else {
                        resolve(result);
                    }
                },
            );

            streamifier.createReadStream(file.buffer).pipe(uploadStream);
        });
    }

    async deleteImage(publicId: string): Promise<void> {
        try {
            await cloudinary.uploader.destroy(publicId);
            this.logger.log(`Deleted image: ${publicId}`);
        } catch (error) {
            this.logger.error(`Failed to delete image: ${publicId}`, error);
        }
    }

    // ─── Optimized URL Helpers (mobile bandwidth savings) ─────

    /** Thumbnail for avatars/lists: 150x150, face crop, aggressive compression */
    static thumbnailUrl(originalUrl: string): string {
        return CloudinaryService.transformUrl(originalUrl, 'w_150,h_150,c_thumb,g_face,f_auto,q_auto:low');
    }

    /** Medium for cards/grids: 400x400, auto quality */
    static mediumUrl(originalUrl: string): string {
        return CloudinaryService.transformUrl(originalUrl, 'w_400,h_400,c_limit,f_auto,q_auto:good');
    }

    /** Full-size for detail views: original size with auto format/quality */
    static fullUrl(originalUrl: string): string {
        return CloudinaryService.transformUrl(originalUrl, 'f_auto,q_auto:good');
    }

    /** Insert Cloudinary transformation into an existing URL */
    private static transformUrl(url: string, transform: string): string {
        if (!url || !url.includes('/upload/')) return url;
        return url.replace('/upload/', `/upload/${transform}/`);
    }
}

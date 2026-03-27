import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import * as streamifier from 'streamifier';

@Injectable()
export class CloudinaryService {
    private readonly logger = new Logger(CloudinaryService.name);

    constructor(private configService: ConfigService) {
        const cloudName = this.configService.get<string>('cloudinary.cloudName');
        const apiKey = this.configService.get<string>('cloudinary.apiKey');
        const apiSecret = this.configService.get<string>('cloudinary.apiSecret');

        cloudinary.config({
            cloud_name: cloudName,
            api_key: apiKey,
            api_secret: apiSecret,
        });

        this.logger.log(`Cloudinary configured: ${cloudName}`);
        this.logger.debug(`API Key: ${apiKey?.substring(0, 4)}...`);
        this.logger.debug(`API Secret: ${apiSecret?.substring(0, 4)}...`);
        
        if (apiKey === apiSecret && apiKey) {
            this.logger.warn('CRITICAL: CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are identical. This will likely cause Invalid Signature errors.');
        }
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
                        const cloudName = this.configService.get('cloudinary.cloudName');
                        const apiKey = this.configService.get('cloudinary.apiKey');
                        
                        this.logger.error(`Cloudinary upload failed: ${error?.message || 'No result'}`, {
                            error: error || 'No result',
                            cloudName: cloudName,
                            apiKey: apiKey?.substring(0, 4) + '...',
                        });
                        const descriptiveError = new Error(`Cloudinary upload failed: ${error?.message || 'No result'}. Please verify your API Key and Secret.`);
                        reject(descriptiveError);
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

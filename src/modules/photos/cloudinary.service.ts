import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import * as streamifier from 'streamifier';

@Injectable()
export class CloudinaryService {
    private readonly logger = new Logger(CloudinaryService.name);
    private static readonly THUMBNAIL_TRANSFORM =
        'w_280,h_280,c_fill,g_auto,f_auto,dpr_auto,q_auto:good';
    private static readonly CARD_TRANSFORM =
        'w_720,h_960,c_fill,g_auto,f_auto,dpr_auto,q_auto:good';
    private static readonly PROFILE_TRANSFORM =
        'w_1600,h_2000,c_limit,f_auto,dpr_auto,q_auto:good';
    private static readonly FULLSCREEN_TRANSFORM =
        'f_auto,dpr_auto,q_auto:best';

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
            const uploadPreset =
                this.configService.get<string>('cloudinary.uploadPreset') ||
                process.env.CLOUDINARY_UPLOAD_PRESET;

            const options: Record<string, unknown> = {
                folder,
                resource_type: 'image',
                use_filename: false,
                unique_filename: true,
                overwrite: false,
            };

            if (uploadPreset && uploadPreset.trim().length > 0) {
                options.upload_preset = uploadPreset.trim();
            }

            const uploadStream = cloudinary.uploader.upload_stream(
                options,
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

    /** Thumbnail for avatars/lists */
    static thumbnailUrl(originalUrl: string): string {
        return CloudinaryService.transformUrl(
            originalUrl,
            CloudinaryService.THUMBNAIL_TRANSFORM,
        );
    }

    /** Optimized card image for discovery/list UIs */
    static cardUrl(originalUrl: string): string {
        return CloudinaryService.transformUrl(
            originalUrl,
            CloudinaryService.CARD_TRANSFORM,
        );
    }

    /** Backward-compatible alias used by existing callers */
    static mediumUrl(originalUrl: string): string {
        return CloudinaryService.cardUrl(originalUrl);
    }

    /** Profile-detail quality for medium-large views */
    static profileUrl(originalUrl: string): string {
        return CloudinaryService.transformUrl(
            originalUrl,
            CloudinaryService.PROFILE_TRANSFORM,
        );
    }

    /** Fullscreen/zoom variant (preserve detail with auto optimization) */
    static fullscreenUrl(originalUrl: string): string {
        return CloudinaryService.transformUrl(
            originalUrl,
            CloudinaryService.FULLSCREEN_TRANSFORM,
        );
    }

    /** Backward-compatible alias used by existing callers */
    static fullUrl(originalUrl: string): string {
        return CloudinaryService.fullscreenUrl(originalUrl);
    }

    static buildImageUrls(originalUrl: string): {
        originalUrl: string;
        thumbnailUrl: string;
        cardUrl: string;
        profileUrl: string;
        fullscreenUrl: string;
    } {
        return {
            originalUrl,
            thumbnailUrl: CloudinaryService.thumbnailUrl(originalUrl),
            cardUrl: CloudinaryService.cardUrl(originalUrl),
            profileUrl: CloudinaryService.profileUrl(originalUrl),
            fullscreenUrl: CloudinaryService.fullscreenUrl(originalUrl),
        };
    }

    /** Insert Cloudinary transformation into an existing URL */
    private static transformUrl(url: string, transform: string): string {
        if (!url || !url.includes('/upload/')) return url;

        const lowered = url.toLowerCase();
        if (!lowered.includes('cloudinary.com/')) return url;

        // Reset existing transformation chain if present, then inject the target transform.
        const resetTransformed = url.replace(
            /\/upload\/(?:[^/]+\/)*(?=v\d+\/)/,
            `/upload/${transform}/`,
        );

        if (resetTransformed !== url) {
            return resetTransformed;
        }

        return url.replace('/upload/', `/upload/${transform}/`);
    }
}

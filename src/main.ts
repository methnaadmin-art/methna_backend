import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import dataSource from './database/data-source';

function isProductionEnv(rawEnv: string): boolean {
    const normalized = rawEnv.trim().toLowerCase();
    return normalized === 'production' || normalized === 'prod';
}

function getConfigString(configService: ConfigService, ...keys: string[]): string {
    for (const key of keys) {
        const value = configService.get<string>(key);
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }
    return '';
}

function validateProductionRuntimeConfig(configService: ConfigService, logger: Logger): void {
    const nodeEnv =
        getConfigString(configService, 'NODE_ENV') ||
        (process.env.NODE_ENV || 'development').trim();
    const isProduction = isProductionEnv(nodeEnv);

    const allowUnverifiedFromConfig = configService.get<boolean>('googlePlay.allowUnverifiedTokens');
    const allowUnverifiedFromEnv =
        getConfigString(configService, 'GOOGLE_PLAY_ALLOW_UNVERIFIED_TOKENS').toLowerCase() === 'true';
    const allowUnverifiedTokens =
        typeof allowUnverifiedFromConfig === 'boolean'
            ? allowUnverifiedFromConfig
            : allowUnverifiedFromEnv;

    const googlePlayClientEmail = getConfigString(
        configService,
        'googlePlay.clientEmail',
        'GOOGLE_PLAY_CLIENT_EMAIL',
    );
    const googlePlayPrivateKey = getConfigString(
        configService,
        'googlePlay.privateKey',
        'GOOGLE_PLAY_PRIVATE_KEY',
    );
    const googlePlayPackageName = getConfigString(
        configService,
        'googlePlay.packageName',
        'GOOGLE_PLAY_PACKAGE_NAME',
    );

    if (isProduction) {
        if (allowUnverifiedTokens) {
            throw new Error(
                'FATAL: GOOGLE_PLAY_ALLOW_UNVERIFIED_TOKENS must be false in production runtime.',
            );
        }

        if (!googlePlayClientEmail || !googlePlayPrivateKey || !googlePlayPackageName) {
            throw new Error(
                'FATAL: Missing Google Play runtime config. Required: GOOGLE_PLAY_CLIENT_EMAIL, GOOGLE_PLAY_PRIVATE_KEY, GOOGLE_PLAY_PACKAGE_NAME.',
            );
        }

        if (!googlePlayClientEmail.endsWith('.gserviceaccount.com')) {
            throw new Error('FATAL: GOOGLE_PLAY_CLIENT_EMAIL is not a valid service account email.');
        }

        if (!googlePlayPrivateKey.includes('BEGIN PRIVATE KEY')) {
            throw new Error('FATAL: GOOGLE_PLAY_PRIVATE_KEY must be a valid PEM private key.');
        }
    }

    if (!isProduction && allowUnverifiedTokens) {
        logger.warn(
            '[CONFIG] Google Play unverified-token bypass is enabled (non-production only).',
        );
    }

    logger.log(
        `[CONFIG] Google Play runtime validation passed (env=${nodeEnv}, strictVerification=${!allowUnverifiedTokens}).`,
    );
}

async function bootstrap() {
    const logger = new Logger('Bootstrap');
    const app = await NestFactory.create(AppModule, {
        // NestJS built-in rawBody support: stores the raw request body as a
        // Buffer on req.rawBody so Stripe webhook signature verification works.
        rawBody: true,
    });

    const configService = app.get(ConfigService);
    const port = configService.get<number>('PORT', 3000);
    const apiPrefix = configService.get<string>('API_PREFIX', 'api/v1');

    validateProductionRuntimeConfig(configService, logger);

    // Security
    app.use(helmet());
    const corsOrigin = configService.get<string>('CORS_ORIGIN', '*');
    if (corsOrigin === '*') {
        logger.warn('⚠️  CORS_ORIGIN is set to "*". Restrict this in production!');
    }
    app.enableCors({
        origin: corsOrigin === '*' ? true : corsOrigin.split(',').map(o => o.trim()),
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
        credentials: true,
    });

    // Global prefix — exclude Stripe webhook path so it's accessible at /webhook/stripe
    // (Stripe Dashboard is configured to send to https://...up.railway.app/webhook/stripe)
    app.setGlobalPrefix(apiPrefix, {
        exclude: ['/webhook/stripe'],
    });

    // Global pipes
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
            transformOptions: {
                enableImplicitConversion: true,
            },
        }),
    );

    // Global filters & interceptors
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(
        new LoggingInterceptor(),
        new TransformInterceptor(),
    );

    // Swagger API docs — only in non-production environments
    if (process.env.NODE_ENV !== 'production') {
        const swaggerConfig = new DocumentBuilder()
            .setTitle('Wafaa API')
            .setDescription('Muslim Matchmaking Platform - REST API Documentation')
            .setVersion('1.0')
            .addBearerAuth()
            .addTag('auth', 'Authentication endpoints')
            .addTag('users', 'User management')
            .addTag('profiles', 'Profile management')
            .addTag('photos', 'Photo uploads')
            .addTag('swipes', 'Swipe / Like system')
            .addTag('matches', 'Match management')
            .addTag('chat', 'Chat & messaging')
            .addTag('notifications', 'Notifications')
            .addTag('subscriptions', 'Premium subscriptions')
            .addTag('search', 'Search & discovery')
            .addTag('reports', 'Reporting & blocking')
            .addTag('admin', 'Admin panel')
            .build();

        const document = SwaggerModule.createDocument(app, swaggerConfig);
        SwaggerModule.setup('api/docs', app, document);
        logger.log('📚 Swagger docs enabled (non-production mode)');
    } else {
        logger.log('📚 Swagger docs DISABLED in production');
    }

    await app.listen(port, '0.0.0.0');

    // Run pending migrations after app is ready
    try {
        if (!dataSource.isInitialized) {
            await dataSource.initialize();
        }
        const migrations = await dataSource.runMigrations({ transaction: 'all' });
        if (migrations.length > 0) {
            logger.log(`✅ Ran ${migrations.length} migration(s): ${migrations.map(m => m.name).join(', ')}`);
        } else {
            logger.log('✅ Database migrations up to date');
        }
    } catch (err) {
        logger.error('❌ Migration run failed — continuing anyway', err);
    }

    logger.log(`🚀 Wafaa API running on http://0.0.0.0:${port}/${apiPrefix}`);
    logger.log(`📚 Swagger docs at http://0.0.0.0:${port}/api/docs`);
}

bootstrap();

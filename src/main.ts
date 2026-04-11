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

async function bootstrap() {
    const logger = new Logger('Bootstrap');
    const app = await NestFactory.create(AppModule, {
        // Buffer raw body so Stripe webhook signature verification works.
        // Without this, NestJS parses JSON before we can verify the signature.
        bodyParser: true,
    });

    // Expose raw body on request for Stripe webhook signature verification.
    // Stripe sends to /webhook/stripe (no api prefix), so we capture raw body
    // on both the prefixed and non-prefixed paths.
    const stripeWebhookPaths = [
        '/webhook/stripe',
        '/api/v1/payments/webhook/stripe',
    ];
    for (const path of stripeWebhookPaths) {
        app.use(path, (req: any, _res: any, next: any) => {
            const chunks: Buffer[] = [];
            req.on('data', (chunk: Buffer) => chunks.push(chunk));
            req.on('end', () => {
                req.rawBody = Buffer.concat(chunks).toString('utf8');
                next();
            });
        });
    }

    const configService = app.get(ConfigService);
    const port = configService.get<number>('PORT', 3000);
    const apiPrefix = configService.get<string>('API_PREFIX', 'api/v1');

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

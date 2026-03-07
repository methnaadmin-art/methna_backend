import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
    const logger = new Logger('Bootstrap');
    const app = await NestFactory.create(AppModule);

    const configService = app.get(ConfigService);
    const port = configService.get<number>('PORT', 3000);
    const apiPrefix = configService.get<string>('API_PREFIX', 'api/v1');

    // Security
    app.use(helmet());
    app.enableCors({
        origin: configService.get<string>('CORS_ORIGIN', '*'),
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
        credentials: true,
    });

    // Global prefix
    app.setGlobalPrefix(apiPrefix);

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

    // Swagger API docs
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

    await app.listen(port, '0.0.0.0');
    logger.log(`🚀 Wafaa API running on http://0.0.0.0:${port}/${apiPrefix}`);
    logger.log(`📚 Swagger docs at http://0.0.0.0:${port}/api/docs`);
}

bootstrap();

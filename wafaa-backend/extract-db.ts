import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { DataSource } from 'typeorm';

async function bootstrap() {
    try {
        const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
        const dataSource = app.get(DataSource);
        const options = dataSource.options as any;
        console.log("DB HOST = ", options.host);
        console.log("DB PORT = ", options.port);
        console.log("DB USER = ", options.username);
        console.log("DB NAME = ", options.database);
        
        // Temporarily patch the DB so it doesn't crash on AdminService
        // Wait, AdminService crashes DURING NestFactory.createApplicationContext!
        // That's why I can't even GET the dataSource!
        
    } catch (e) {
        console.error("Context creation failed:", e.message);
    }
}
bootstrap();

import { Module, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseCompatibilityService } from './database-compatibility.service';

const dbLogger = new Logger('DatabaseModule');

function sanitizeDatabaseUrl(url?: string) {
    if (!url) return url;

    try {
        const parsed = new URL(url);
        parsed.searchParams.delete('sslmode');
        parsed.searchParams.delete('uselibpqcompat');
        return parsed.toString();
    } catch {
        return url;
    }
}

@Module({
    imports: [
        TypeOrmModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
                const rawDatabaseUrl = configService.get<string>('database.url');
                const databaseUrl = sanitizeDatabaseUrl(rawDatabaseUrl);
                const dbHost = configService.get<string>('database.host');

                let connectionConfig: any;

                if (databaseUrl) {
                    dbLogger.log(`Using DATABASE_URL (host: ${new URL(databaseUrl).hostname})`);
                    connectionConfig = { url: databaseUrl };
                } else {
                    dbLogger.log(`Using individual DB vars (host: ${dbHost})`);
                    connectionConfig = {
                        host: dbHost,
                        port: configService.get<number>('database.port'),
                        username: configService.get<string>('database.username'),
                        password: configService.get<string>('database.password'),
                        database: configService.get<string>('database.name'),
                    };
                }

                const isProduction = process.env.NODE_ENV === 'production';
                const isNeon = databaseUrl?.includes('neon.tech') ?? false;

                return {
                    type: 'postgres',
                    ...connectionConfig,
                    ssl: { rejectUnauthorized: false },
                    autoLoadEntities: true,
                    synchronize: !isProduction,
                    logging: !isProduction ? ['error', 'warn', 'query'] : ['error'],
                    entities: [__dirname + '/entities/**/*.entity{.ts,.js}'],
                    retryAttempts: 5,
                    retryDelay: 3000,
                    extra: {
                        max: isNeon ? 20 : (isProduction ? 50 : 10),
                        min: isNeon ? 2 : (isProduction ? 5 : 2),
                        idleTimeoutMillis: isNeon ? 10000 : 30000,
                        connectionTimeoutMillis: 10000,
                        statement_timeout: 30000,
                        keepAlive: true,
                        keepAliveInitialDelayMillis: 10000,
                    },
                };
            },
        }),
    ],
    providers: [DatabaseCompatibilityService],
})
export class DatabaseModule { }

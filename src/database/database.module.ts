import { Module, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

const dbLogger = new Logger('DatabaseModule');

@Module({
    imports: [
        TypeOrmModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
                const databaseUrl = configService.get<string>('database.url');
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

                return {
                    type: 'postgres',
                    ...connectionConfig,
                    ssl: { rejectUnauthorized: false },
                    autoLoadEntities: true,
                    synchronize: !isProduction,
                    logging: !isProduction,
                    entities: [__dirname + '/entities/**/*.entity{.ts,.js}'],
                    retryAttempts: 5,
                    retryDelay: 3000,
                    // Connection pool tuning for scale (1000-10000 users)
                    extra: {
                        max: isProduction ? 100 : 20,             // Max pool connections (scaled for 10k users)
                        min: isProduction ? 10 : 2,               // Min idle connections
                        idleTimeoutMillis: 30000,                 // Close idle connections after 30s
                        connectionTimeoutMillis: 10000,           // Fail fast if can't connect in 10s
                        statement_timeout: 30000,                 // Kill queries longer than 30s
                    },
                };
            },
        }),
    ],
})
export class DatabaseModule { }

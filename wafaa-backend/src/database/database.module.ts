import { Module, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

const logger = new Logger('DatabaseModule');

@Module({
    imports: [
        TypeOrmModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => {
                const host = configService.get<string>('database.host');
                logger.log(`[DB CONFIG] Connecting to ${host}:${configService.get<number>('database.port')}`);
                logger.log(`[DB CONFIG] synchronize=false, logging=false (fast startup)`);

                return {
                    type: 'postgres',
                    host,
                    port: configService.get<number>('database.port'),
                    username: configService.get<string>('database.username'),
                    password: configService.get<string>('database.password'),
                    database: configService.get<string>('database.name'),
                    ssl: configService.get<boolean>('database.ssl')
                        ? { rejectUnauthorized: false }
                        : false,
                    autoLoadEntities: true,
                    // CRITICAL: synchronize=false prevents slow schema introspection
                    // that blocks startup for 60+ seconds on remote Neon DB
                    synchronize: false,
                    // Disable query logging to avoid console flooding
                    logging: false,
                    entities: [__dirname + '/entities/**/*.entity{.ts,.js}'],
                    migrations: [__dirname + '/migrations/*{.ts,.js}'],
                    migrationsRun: true,
                    // Connection timeout: fail fast if DB unreachable
                    connectTimeoutMS: 10000,
                    extra: {
                        // PostgreSQL statement timeout (30s)
                        statement_timeout: 30000,
                        idle_in_transaction_session_timeout: 30000,
                        // pg driver connection timeout
                        connectionTimeoutMillis: 10000,
                        // pg pool: don't wait forever for a connection
                        idleTimeoutMillis: 30000,
                    },
                };
            },
        }),
    ],
})
export class DatabaseModule { }

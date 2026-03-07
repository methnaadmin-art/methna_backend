import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
    imports: [
        TypeOrmModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => ({
                type: 'postgres',
                ...(configService.get<string>('database.url')
                    ? { url: configService.get<string>('database.url') }
                    : configService.get<string>('database.host')?.includes('db.hjojxhcuokbflvemztji.supabase.co')
                        ? {
                            url: `postgresql://${configService.get<string>('database.username')}.hjojxhcuokbflvemztji:${configService.get<string>('database.password')}@aws-0-eu-west-1.pooler.supabase.com:6543/${configService.get<string>('database.name')}?pgbouncer=true`,
                        }
                        : {
                            host: configService.get<string>('database.host'),
                            port: configService.get<number>('database.port'),
                            username: configService.get<string>('database.username'),
                            password: configService.get<string>('database.password'),
                            database: configService.get<string>('database.name'),
                        }),
                ssl: configService.get<boolean>('database.ssl')
                    ? { rejectUnauthorized: false }
                    : false,
                autoLoadEntities: true,
                synchronize: process.env.NODE_ENV !== 'production',
                logging: process.env.NODE_ENV === 'development',
                entities: [__dirname + '/entities/**/*.entity{.ts,.js}'],
            }),
        }),
    ],
})
export class DatabaseModule { }

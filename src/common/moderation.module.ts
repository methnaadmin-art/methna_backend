import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../database/entities/user.entity';
import { ModerationGuard } from './guards/moderation.guard';
import { RedisModule } from '../modules/redis/redis.module';

@Global()
@Module({
    imports: [
        TypeOrmModule.forFeature([User]),
        RedisModule,
    ],
    providers: [ModerationGuard],
    exports: [ModerationGuard, TypeOrmModule, RedisModule],
})
export class ModerationModule {}

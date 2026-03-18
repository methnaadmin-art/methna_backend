import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SecurityService } from './security.service';
import { SecurityController } from './security.controller';
import { User } from '../../database/entities/user.entity';
import { UserDevice } from '../../database/entities/user-device.entity';
import { LoginHistory } from '../../database/entities/login-history.entity';
import { EmailBlacklist } from '../../database/entities/email-blacklist.entity';
import { RedisModule } from '../redis/redis.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([User, UserDevice, LoginHistory, EmailBlacklist]),
        RedisModule,
    ],
    controllers: [SecurityController],
    providers: [SecurityService],
    exports: [SecurityService],
})
export class SecurityModule { }

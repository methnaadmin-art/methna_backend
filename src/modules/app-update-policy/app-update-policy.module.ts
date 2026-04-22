import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppUpdatePolicy } from '../../database/entities/app-update-policy.entity';
import { AppUpdatePolicyService } from './app-update-policy.service';

@Module({
    imports: [TypeOrmModule.forFeature([AppUpdatePolicy])],
    providers: [AppUpdatePolicyService],
    exports: [AppUpdatePolicyService],
})
export class AppUpdatePolicyModule {}

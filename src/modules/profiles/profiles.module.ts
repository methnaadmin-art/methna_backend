import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { Profile } from '../../database/entities/profile.entity';
import { UserPreference } from '../../database/entities/user-preference.entity';
import { CategoriesModule } from '../categories/categories.module';
import { TrustSafetyModule } from '../trust-safety/trust-safety.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Profile, UserPreference]),
        forwardRef(() => CategoriesModule),
        TrustSafetyModule,
    ],
    controllers: [ProfilesController],
    providers: [ProfilesService],
    exports: [ProfilesService],
})
export class ProfilesModule { }

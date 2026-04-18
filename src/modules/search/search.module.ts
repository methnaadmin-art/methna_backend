import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { Profile } from '../../database/entities/profile.entity';
import { Photo } from '../../database/entities/photo.entity';
import { BlockedUser } from '../../database/entities/blocked-user.entity';
import { Like } from '../../database/entities/like.entity';
import { Match } from '../../database/entities/match.entity';
import { UserPreference } from '../../database/entities/user-preference.entity';
import { ModerationModule } from '../../common/moderation.module';
import { PlansModule } from '../plans/plans.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            Profile,
            Photo,
            BlockedUser,
            Like,
            Match,
            UserPreference,
        ]),
        ModerationModule,
        PlansModule,
    ],
    controllers: [SearchController],
    providers: [SearchService],
    exports: [SearchService],
})
export class SearchModule { }

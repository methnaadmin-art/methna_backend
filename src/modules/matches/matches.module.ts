import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';
import { Match } from '../../database/entities/match.entity';
import { Like } from '../../database/entities/like.entity';
import { Profile } from '../../database/entities/profile.entity';
import { UserPreference } from '../../database/entities/user-preference.entity';
import { BlockedUser } from '../../database/entities/blocked-user.entity';
import { Photo } from '../../database/entities/photo.entity';
import { Conversation } from '../../database/entities/conversation.entity';
import { User } from '../../database/entities/user.entity';
import { ModerationModule } from '../../common/moderation.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Match, Like, Profile, UserPreference, BlockedUser, Photo, Conversation, User]),
        ModerationModule,
    ],
    controllers: [MatchesController],
    providers: [MatchesService],
    exports: [MatchesService],
})
export class MatchesModule { }

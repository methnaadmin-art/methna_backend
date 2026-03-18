import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SwipesController } from './swipes.controller';
import { SwipesService } from './swipes.service';
import { Like } from '../../database/entities/like.entity';
import { Match } from '../../database/entities/match.entity';
import { BlockedUser } from '../../database/entities/blocked-user.entity';
import { Subscription } from '../../database/entities/subscription.entity';
import { Profile } from '../../database/entities/profile.entity';
import { UserPreference } from '../../database/entities/user-preference.entity';
import { Conversation } from '../../database/entities/conversation.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Like, Match, BlockedUser, Subscription, Profile, UserPreference, Conversation]),
        NotificationsModule,
    ],
    controllers: [SwipesController],
    providers: [SwipesService],
    exports: [SwipesService],
})
export class SwipesModule { }

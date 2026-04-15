import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SwipesController } from './swipes.controller';
import { SwipesService } from './swipes.service';
import { Like } from '../../database/entities/like.entity';
import { Match } from '../../database/entities/match.entity';
import { BlockedUser } from '../../database/entities/blocked-user.entity';
import { Profile } from '../../database/entities/profile.entity';
import { UserPreference } from '../../database/entities/user-preference.entity';
import { Conversation } from '../../database/entities/conversation.entity';
import { RematchRequest } from '../../database/entities/rematch-request.entity';
import { User } from '../../database/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { MonetizationModule } from '../monetization/monetization.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ModerationModule } from '../../common/moderation.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Like, Match, BlockedUser, Profile, UserPreference, Conversation, RematchRequest, User]),
        NotificationsModule,
        MonetizationModule,
        SubscriptionsModule,
        ModerationModule,
    ],
    controllers: [SwipesController],
    providers: [SwipesService],
    exports: [SwipesService],
})
export class SwipesModule { }

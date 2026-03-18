import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    Index,
} from 'typeorm';

export enum AnalyticsEventType {
    USER_SIGNUP = 'user_signup',
    USER_LOGIN = 'user_login',
    USER_ACTIVE = 'user_active',
    PROFILE_VIEW = 'profile_view',
    SWIPE_LIKE = 'swipe_like',
    SWIPE_PASS = 'swipe_pass',
    SWIPE_SUPER_LIKE = 'swipe_super_like',
    MATCH_CREATED = 'match_created',
    MESSAGE_SENT = 'message_sent',
    SUBSCRIPTION_PURCHASED = 'subscription_purchased',
    BOOST_PURCHASED = 'boost_purchased',
    REPORT_CREATED = 'report_created',
}

@Entity('analytics_events')
export class AnalyticsEvent {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column({ type: 'enum', enum: AnalyticsEventType })
    eventType: AnalyticsEventType;

    @Index()
    @Column({ nullable: true })
    userId: string;

    @Column({ type: 'jsonb', nullable: true })
    metadata: Record<string, any>;

    @Index()
    @Column({ type: 'date' })
    eventDate: string;

    @CreateDateColumn()
    createdAt: Date;
}

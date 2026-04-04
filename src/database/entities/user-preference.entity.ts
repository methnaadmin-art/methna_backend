import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    OneToOne,
    JoinColumn,
    Index,
} from 'typeorm';
import { User } from './user.entity';
import { Gender, ReligiousLevel, MaritalStatus } from './profile.entity';

@Entity('user_preferences')
export class UserPreference {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column()
    userId: string;

    @OneToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'userId' })
    user: User;

    @Column({ type: 'int', default: 18 })
    minAge: number;

    @Column({ type: 'int', default: 60 })
    maxAge: number;

    @Column({ type: 'enum', enum: Gender, nullable: true })
    preferredGender: Gender;

    @Column({ type: 'int', default: 100 })
    maxDistance: number; // in km

    @Column({ type: 'simple-array', nullable: true })
    preferredEthnicities: string[];

    @Column({ type: 'simple-array', nullable: true })
    preferredNationalities: string[];

    @Column({ type: 'enum', enum: ReligiousLevel, nullable: true })
    preferredReligiousLevel: ReligiousLevel;

    @Column({ type: 'enum', enum: MaritalStatus, nullable: true })
    preferredMaritalStatus: MaritalStatus;

    @Column({ type: 'simple-array', nullable: true })
    preferredInterests: string[];

    @Column({ type: 'simple-array', nullable: true })
    preferredLanguages: string[];

    @Column({ type: 'simple-array', nullable: true })
    preferredFamilyValues: string[];

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

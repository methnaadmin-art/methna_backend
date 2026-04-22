import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
} from 'typeorm';

@Entity('app_update_policies')
export class AppUpdatePolicy {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ default: false })
    isActive: boolean;

    @Column({ type: 'varchar', length: 64, nullable: true })
    minimumSupportedVersion: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    latestVersion: string | null;

    @Column({ type: 'varchar', length: 160, nullable: true })
    title: string | null;

    @Column({ type: 'text', nullable: true })
    hardUpdateMessage: string | null;

    @Column({ type: 'text', nullable: true })
    softUpdateMessage: string | null;

    @Column({ type: 'varchar', length: 512, nullable: true })
    storeUrlAndroid: string | null;

    @Column({ type: 'varchar', length: 512, nullable: true })
    storeUrliOS: string | null;

    @Column({ type: 'varchar', length: 64, nullable: true })
    updatedById: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

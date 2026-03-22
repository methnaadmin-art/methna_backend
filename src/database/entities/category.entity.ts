import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToMany,
    JoinTable,
} from 'typeorm';
import { User } from './user.entity';

export enum CategoryStatus {
    ACTIVE = 'active',
    INACTIVE = 'inactive',
}

/**
 * A single rule condition for dynamic category assignment.
 * Example: { "field": "religiousLevel", "operator": "=", "value": "very_practicing" }
 */
export interface RuleCondition {
    field: string;
    operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'includes' | 'not_includes';
    value: string | number | boolean;
}

@Entity('categories')
export class Category {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ length: 100 })
    name: string;

    @Column({ length: 500, nullable: true })
    description: string;

    @Column({ nullable: true })
    icon: string; // URL or Lottie asset key

    @Column({ type: 'enum', enum: CategoryStatus, default: CategoryStatus.ACTIVE })
    status: CategoryStatus;

    @Column({ type: 'int', default: 0 })
    sortOrder: number;

    /**
     * JSON-based rules engine conditions.
     * All conditions are combined with AND logic.
     * Evaluated against the user's Profile entity fields.
     */
    @Column({ type: 'jsonb', default: [] })
    rules: RuleCondition[];

    @Column({ nullable: true, length: 20 })
    color: string; // hex color for UI theming, e.g. "#2d7a4f"

    @ManyToMany(() => User)
    @JoinTable({
        name: 'user_categories',
        joinColumn: { name: 'categoryId', referencedColumnName: 'id' },
        inverseJoinColumn: { name: 'userId', referencedColumnName: 'id' },
    })
    users: User[];

    @Column({ type: 'int', default: 0 })
    userCount: number;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

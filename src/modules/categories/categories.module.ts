import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { Category } from '../../database/entities/category.entity';
import { Profile } from '../../database/entities/profile.entity';
import { User } from '../../database/entities/user.entity';

@Module({
    imports: [TypeOrmModule.forFeature([Category, Profile, User])],
    controllers: [CategoriesController],
    providers: [CategoriesService],
    exports: [CategoriesService],
})
export class CategoriesModule {}

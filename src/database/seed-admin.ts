import * as dotenv from 'dotenv';
dotenv.config();

import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User, UserRole, UserStatus } from './entities/user.entity';

/**
 * Seed script to create an admin account.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/database/seed-admin.ts
 *
 * Environment variables required:
 *   DATABASE_URL  or  DB_HOST, DB_PORT, DB_USERNAME, DB_PASSWORD, DB_NAME
 *
 * Default admin credentials (change password after first login):
 *   Email:    admin@wafaa.app
 *   Password: Admin@123456
 */

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@wafaa.app';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@123456';
const ADMIN_FIRST_NAME = process.env.ADMIN_FIRST_NAME || 'Super';
const ADMIN_LAST_NAME = process.env.ADMIN_LAST_NAME || 'Admin';

async function seed() {
    const databaseUrl = process.env.DATABASE_URL || '';

    const connectionOptions: any = databaseUrl
        ? { url: databaseUrl }
        : {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '5432', 10),
            username: process.env.DB_USERNAME || 'postgres',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'postgres',
        };

    const dataSource = new DataSource({
        type: 'postgres',
        ...connectionOptions,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
        entities: [User],
        synchronize: false,
    });

    try {
        await dataSource.initialize();
        console.log('Connected to database.');

        const userRepo = dataSource.getRepository(User);

        // Check if admin already exists
        const existing = await userRepo.findOne({ where: { email: ADMIN_EMAIL } });
        if (existing) {
            if (existing.role === UserRole.ADMIN) {
                console.log(`Admin account already exists: ${ADMIN_EMAIL}`);
                console.log('If you need to reset the password, delete the user and re-run this script.');
            } else {
                // Upgrade to admin
                existing.role = UserRole.ADMIN;
                existing.status = UserStatus.ACTIVE;
                existing.emailVerified = true;
                await userRepo.save(existing);
                console.log(`Existing user ${ADMIN_EMAIL} upgraded to ADMIN role.`);
            }
            await dataSource.destroy();
            return;
        }

        // Hash password
        const salt = await bcrypt.genSalt(12);
        const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, salt);

        // Create admin user
        const admin = userRepo.create({
            email: ADMIN_EMAIL,
            password: hashedPassword,
            firstName: ADMIN_FIRST_NAME,
            lastName: ADMIN_LAST_NAME,
            username: 'admin',
            role: UserRole.ADMIN,
            status: UserStatus.ACTIVE,
            emailVerified: true,
            trustScore: 100,
            notificationsEnabled: true,
            matchNotifications: true,
            messageNotifications: true,
            likeNotifications: true,
        });

        await userRepo.save(admin);

        console.log('');
        console.log('=== Admin Account Created ===');
        console.log(`  Email:    ${ADMIN_EMAIL}`);
        console.log(`  Password: ${ADMIN_PASSWORD}`);
        console.log(`  Role:     admin`);
        console.log(`  Status:   active`);
        console.log('');
        console.log('IMPORTANT: Change the default password after your first login!');
        console.log('');

        await dataSource.destroy();
    } catch (error) {
        console.error('Seed failed:', error);
        process.exit(1);
    }
}

seed();

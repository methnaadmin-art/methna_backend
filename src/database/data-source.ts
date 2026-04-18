import 'dotenv/config';
import { DataSource } from 'typeorm';

function sanitizeDatabaseUrl(url?: string): string | undefined {
    if (!url) return undefined;

    try {
        const parsed = new URL(url);
        parsed.searchParams.delete('sslmode');
        parsed.searchParams.delete('uselibpqcompat');
        return parsed.toString();
    } catch {
        return url;
    }
}

const databaseUrl = sanitizeDatabaseUrl(process.env.DATABASE_URL);
const isTsRuntime = __filename.endsWith('.ts');

const entities = isTsRuntime
    ? ['src/**/*.entity.ts']
    : ['dist/src/**/*.entity.js'];

const migrations = isTsRuntime
    ? ['src/database/migrations/*{.ts,.js}']
    : ['dist/src/database/migrations/*.js'];

const dataSource = new DataSource({
    type: 'postgres',
    ...(databaseUrl
        ? { url: databaseUrl }
        : {
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '5432', 10),
            username: process.env.DB_USERNAME || 'postgres',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'postgres',
        }),
    ssl: { rejectUnauthorized: false },
    entities,
    migrations,
    synchronize: false,
    logging: false,
});

export default dataSource;

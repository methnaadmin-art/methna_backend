export default () => ({
    port: parseInt(process.env.PORT || '3000', 10),
    apiPrefix: process.env.API_PREFIX || 'api/v1',

    jwt: {
        secret: process.env.JWT_SECRET || 'default-secret',
        expiration: process.env.JWT_EXPIRATION || '15m',
        refreshSecret: process.env.JWT_REFRESH_SECRET || 'default-refresh-secret',
        refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
    },

    database: {
        url: process.env.DATABASE_URL || '',
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        username: process.env.DB_USERNAME || 'postgres',
        password: process.env.DB_PASSWORD || '',
        name: process.env.DB_NAME || 'postgres',
        ssl: process.env.DB_SSL === 'true',
    },

    redis: {
        url: process.env.REDIS_URL || '',
        token: process.env.REDIS_TOKEN || '',
    },

    cloudinary: {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
        apiKey: process.env.CLOUDINARY_API_KEY || '',
        apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    },

    throttle: {
        ttl: parseInt(process.env.THROTTLE_TTL || '60', 10),
        limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
    },
});

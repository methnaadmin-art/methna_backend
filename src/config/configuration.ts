export default () => {
    // Validate critical secrets at startup
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'default-secret') {
        throw new Error('FATAL: JWT_SECRET environment variable must be set to a strong, unique value.');
    }
    if (!process.env.JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET === 'default-refresh-secret') {
        throw new Error('FATAL: JWT_REFRESH_SECRET environment variable must be set to a strong, unique value.');
    }

    const nodeEnv = (process.env.NODE_ENV || 'development').trim().toLowerCase();
    const isProduction = nodeEnv === 'production' || nodeEnv === 'prod';
    const defaultJwtExpiration = isProduction ? '15m' : '2h';

    // Safe default is false when env var is absent.
    const googlePlayAllowUnverifiedTokens =
        process.env.GOOGLE_PLAY_ALLOW_UNVERIFIED_TOKENS === 'true';
    const googlePlayClientEmail = (process.env.GOOGLE_PLAY_CLIENT_EMAIL || '').trim();
    const googlePlayPrivateKey = (process.env.GOOGLE_PLAY_PRIVATE_KEY || '').trim();
    const googlePlayPackageName = (process.env.GOOGLE_PLAY_PACKAGE_NAME || '').trim();

    if (isProduction && googlePlayAllowUnverifiedTokens) {
        throw new Error(
            'FATAL: GOOGLE_PLAY_ALLOW_UNVERIFIED_TOKENS must be false in production.',
        );
    }

    if (isProduction) {
        if (!googlePlayClientEmail || !googlePlayPrivateKey || !googlePlayPackageName) {
            throw new Error(
                'FATAL: GOOGLE_PLAY_CLIENT_EMAIL, GOOGLE_PLAY_PRIVATE_KEY, and GOOGLE_PLAY_PACKAGE_NAME are required in production.',
            );
        }

        if (!googlePlayClientEmail.endsWith('.gserviceaccount.com')) {
            throw new Error(
                'FATAL: GOOGLE_PLAY_CLIENT_EMAIL must be a valid Google service account email.',
            );
        }

        if (!googlePlayPrivateKey.includes('BEGIN PRIVATE KEY')) {
            throw new Error(
                'FATAL: GOOGLE_PLAY_PRIVATE_KEY is not in valid PEM private key format.',
            );
        }
    }

    return {
        port: parseInt(process.env.PORT || '3000', 10),
        apiPrefix: process.env.API_PREFIX || 'api/v1',

        jwt: {
            secret: process.env.JWT_SECRET,
            expiration: process.env.JWT_EXPIRATION || defaultJwtExpiration,
            refreshSecret: process.env.JWT_REFRESH_SECRET,
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

        cloudinary: {
            cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
            apiKey: process.env.CLOUDINARY_API_KEY || '',
            apiSecret: process.env.CLOUDINARY_API_SECRET || '',
        },

        mail: {
            host: process.env.MAIL_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.MAIL_PORT || '587', 10),
            user: process.env.MAIL_USER || '',
            pass: process.env.MAIL_PASS || '',
            from: process.env.MAIL_FROM || 'Methna App <verify@waqti.pro>',
        },

        resend: {
            apiKey: process.env.RESEND_API_KEY || '',
            agreementTemplateId: process.env.RESEND_AGREEMENT_TEMPLATE_ID || 'agreement-confirmation',
            agreementDelayMs: parseInt(process.env.RESEND_AGREEMENT_DELAY_MS || '120000', 10),
        },

        firebase: {
            projectId: process.env.FIREBASE_PROJECT_ID || '',
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
            privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
        },

        otp: {
            expirySeconds: parseInt(process.env.OTP_EXPIRY_SECONDS || '300', 10),
            cooldownSeconds: parseInt(process.env.OTP_COOLDOWN_SECONDS || '60', 10),
            maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS || '5', 10),
        },

        stripe: {
            secretKey: process.env.STRIPE_SECRET_KEY || '',
            publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
            webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
            successUrl: process.env.STRIPE_SUCCESS_URL || 'methna://payment-success',
            cancelUrl: process.env.STRIPE_CANCEL_URL || 'methna://payment-cancel',
            managementUrl: process.env.STRIPE_MANAGEMENT_URL || 'https://billing.stripe.com/p/login',
            pricePremium: process.env.STRIPE_PRICE_PREMIUM || '',
            priceGold: process.env.STRIPE_PRICE_GOLD || '',
        },

        googlePlay: {
            clientEmail: process.env.GOOGLE_PLAY_CLIENT_EMAIL || '',
            privateKey: (process.env.GOOGLE_PLAY_PRIVATE_KEY || '')
                .replace(/^"|"$/g, '')   // strip wrapping double quotes from .env
                .replace(/\\n/g, '\n'),   // replace literal \n with real newlines
            packageName: process.env.GOOGLE_PLAY_PACKAGE_NAME || '',
            allowUnverifiedTokens: googlePlayAllowUnverifiedTokens,
            licensingPublicKey: process.env.GOOGLE_PLAY_LICENSING_PUBLIC_KEY || '',
            subscriptionManagementUrl:
                process.env.GOOGLE_PLAY_SUBSCRIPTION_MANAGEMENT_URL ||
                'https://play.google.com/store/account/subscriptions',
            ucbEligibleCountries: process.env.GOOGLE_PLAY_UCB_ELIGIBLE_COUNTRIES || 'GB',
        },

        google: {
            webClientId: process.env.GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '',
        },

        throttle: {
            ttl: parseInt(process.env.THROTTLE_TTL || '60', 10),
            limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
        },
    };
};

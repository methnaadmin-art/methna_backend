import dataSource from '../src/database/data-source';
import {
    ConsumableProduct,
    ConsumableType,
    PlatformAvailability,
} from '../src/database/entities/consumable-product.entity';

type SeedProduct = {
    code: string;
    title: string;
    description: string;
    type: ConsumableType;
    quantity: number;
    price: number;
    currency: string;
    platformAvailability: PlatformAvailability;
    sortOrder: number;
    googleProductId: string;
    stripePriceId: string | null;
    stripeProductId: string | null;
};

const SEED_PRODUCTS: SeedProduct[] = [
    {
        code: 'likes_25_pack',
        title: '25 Likes Pack',
        description: 'Adds 25 likes to your balance.',
        type: ConsumableType.LIKES_PACK,
        quantity: 25,
        price: 4.99,
        currency: 'usd',
        platformAvailability: PlatformAvailability.ALL,
        sortOrder: 10,
        googleProductId: 'com.methna.consumable.likes_25',
        stripePriceId: null,
        stripeProductId: null,
    },
    {
        code: 'compliments_10_pack',
        title: '10 Compliments Pack',
        description: 'Adds 10 compliments to your balance.',
        type: ConsumableType.COMPLIMENTS_PACK,
        quantity: 10,
        price: 3.99,
        currency: 'usd',
        platformAvailability: PlatformAvailability.ALL,
        sortOrder: 20,
        googleProductId: 'com.methna.consumable.compliments_10',
        stripePriceId: null,
        stripeProductId: null,
    },
    {
        code: 'boosts_3_pack',
        title: '3 Boosts Pack',
        description: 'Adds 3 profile boosts to your balance.',
        type: ConsumableType.BOOSTS_PACK,
        quantity: 3,
        price: 6.99,
        currency: 'usd',
        platformAvailability: PlatformAvailability.ALL,
        sortOrder: 30,
        googleProductId: 'com.methna.consumable.boosts_3',
        stripePriceId: null,
        stripeProductId: null,
    },
];

async function upsertConsumableCatalog(): Promise<void> {
    if (!dataSource.isInitialized) {
        await dataSource.initialize();
    }

    const repository = dataSource.getRepository(ConsumableProduct);

    for (const seed of SEED_PRODUCTS) {
        const existing = await repository.findOne({ where: { code: seed.code } });

        if (!existing) {
            const created = repository.create({
                ...seed,
                isActive: true,
                isArchived: false,
            });
            await repository.save(created);
            console.log(`Created consumable: ${seed.code}`);
            continue;
        }

        existing.title = seed.title;
        existing.description = seed.description;
        existing.type = seed.type;
        existing.quantity = seed.quantity;
        existing.price = seed.price;
        existing.currency = seed.currency;
        existing.platformAvailability = seed.platformAvailability;
        existing.sortOrder = seed.sortOrder;
        existing.googleProductId = seed.googleProductId;
        existing.stripePriceId = seed.stripePriceId;
        existing.stripeProductId = seed.stripeProductId;
        existing.isActive = true;
        existing.isArchived = false;

        await repository.save(existing);
        console.log(`Updated consumable: ${seed.code}`);
    }

    const total = await repository.count({ where: { isActive: true, isArchived: false } });
    console.log(`Active consumables available: ${total}`);
}

upsertConsumableCatalog()
    .catch((error) => {
        console.error('Failed to seed consumables catalog:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        if (dataSource.isInitialized) {
            await dataSource.destroy();
        }
    });

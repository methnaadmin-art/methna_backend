require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const plans = await client.query(
    'SELECT id, code, price, "googleProductId" AS google_product_id, "googleBasePlanId" AS google_base_plan_id, "isActive" AS is_active, "isVisible" AS is_visible FROM plans ORDER BY code',
  );

  const consumables = await client.query(
    'SELECT id, code, type, quantity, "googleProductId" AS google_product_id, "isActive" AS is_active, "isArchived" AS is_archived, "platformAvailability" AS platform_availability FROM consumable_products ORDER BY code',
  );

  console.log('=== PLANS ===');
  console.log(JSON.stringify(plans.rows, null, 2));
  console.log('=== CONSUMABLES ===');
  console.log(JSON.stringify(consumables.rows, null, 2));

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

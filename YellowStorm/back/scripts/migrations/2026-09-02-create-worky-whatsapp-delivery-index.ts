/* eslint-disable no-console */
/**
 * One-shot migration for the Worky manager-message WhatsApp delivery outbox.
 * Production disables Mongoose auto-indexing. Safe to run multiple times.
 *
 * Usage:
 *   cd back && npx ts-node scripts/migrations/2026-09-02-create-worky-whatsapp-delivery-index.ts
 */
import { config as loadEnv } from 'dotenv';
import { MongoClient } from 'mongodb';

async function main(): Promise<void> {
  loadEnv();
  const uri = process.env.MONGODB_URI ?? process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI not set in .env');

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const indexName = await client.db().collection('worky_messages').createIndex({
      'whatsappDelivery.status': 1,
      'whatsappDelivery.nextAttemptAt': 1,
      'whatsappDelivery.leaseExpiresAt': 1,
    });
    console.log(`Ensured Worky WhatsApp delivery index '${indexName}'`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

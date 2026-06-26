/* eslint-disable no-console */
/**
 * One-shot migration for the "Model Classification by Type" feature.
 *
 * Until now the model sync only stored models with mode === 'chat', so every
 * document currently in the `models` collection is a chat model by definition.
 * The new `type` field defaults to '' (unclassified), and the public model
 * selector now filters on `type === 'chat'`. Without this backfill, every
 * existing chat model would temporarily disappear from the selector until the
 * next sync.
 *
 * This script sets `type: 'chat'` on all existing models that are still
 * unclassified.
 *
 * IMPORTANT: run this ONCE, right after deploying the schema change and BEFORE
 * triggering a re-sync from LiteLLM (a re-sync may add genuinely non-chat
 * models with an empty type that must NOT be turned into chat).
 *
 * Usage:
 *   cd back && npx ts-node scripts/migrations/2026-06-26-backfill-model-type-chat.ts
 */
import { config as loadEnv } from 'dotenv';
import { MongoClient } from 'mongodb';

async function main(): Promise<void> {
  loadEnv();
  const uri = process.env.MONGODB_URI ?? process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGODB_URI not set in .env');
  }
  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db();
    const col = db.collection('models');

    const result = await col.updateMany(
      { $or: [{ type: { $exists: false } }, { type: '' }] },
      { $set: { type: 'chat' } },
    );

    console.log(`Backfilled type='chat' on ${result.modifiedCount} existing models.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

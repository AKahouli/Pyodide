/* eslint-disable no-console */
/**
 * One-shot migration: remove the legacy NodeTemplate `type` field/index.
 *
 * FlowNodeTemplate now uses `key` as the only stable template identifier.
 * Mongoose does not drop old indexes automatically, so the previous unique
 * `type_1` index must be removed from MongoDB metadata.
 *
 * Usage:
 *   cd back && npx ts-node scripts/migrations/2026-06-28-drop-playbook-node-template-type-index.ts
 *
 * Safe to run multiple times.
 */
import { config as loadEnv } from 'dotenv';
import { MongoClient } from 'mongodb';

async function dropLegacyTypeIndex(client: MongoClient): Promise<void> {
  const col = client.db().collection('playbook_flow_node_templates');
  try {
    await col.dropIndex('type_1');
    console.log("Dropped legacy index 'type_1' from playbook_flow_node_templates");
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('index not found') || msg.includes('IndexNotFound')) {
      console.log("Index 'type_1' not present - already dropped or never existed");
      return;
    }
    throw err;
  }
}

async function unsetLegacyTypeField(client: MongoClient): Promise<void> {
  const col = client.db().collection('playbook_flow_node_templates');
  const result = await col.updateMany({ type: { $exists: true } }, { $unset: { type: '' } });
  console.log(`Unset legacy type field on ${result.modifiedCount} playbook node templates`);
}

async function main(): Promise<void> {
  loadEnv();
  const uri = process.env.MONGODB_URI ?? process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGODB_URI not set in .env');
  }

  const client = new MongoClient(uri);
  await client.connect();

  try {
    await dropLegacyTypeIndex(client);
    await unsetLegacyTypeField(client);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

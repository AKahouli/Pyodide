/* eslint-disable no-console */
/**
 * One-shot migration: index playbook flows by referenced connector binding.
 *
 * Connector action updates synchronize matching playbook bindings through
 * `nodes.metadata.toolBindings.connectorId`. Production disables Mongoose
 * auto-indexing, so the index must be created explicitly.
 *
 * Usage:
 *   cd back && npx ts-node scripts/migrations/2026-07-09-create-flow-toolbindings-connectorid-index.ts
 *
 * Safe to run multiple times.
 */
import { config as loadEnv } from 'dotenv';
import { MongoClient } from 'mongodb';

async function createConnectorBindingIndex(client: MongoClient): Promise<void> {
  const col = client.db().collection('flows');
  const indexName = await col.createIndex(
    { 'nodes.metadata.toolBindings.connectorId': 1 },
  );
  console.log(`Ensured flow connector binding index '${indexName}'`);
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
    await createConnectorBindingIndex(client);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

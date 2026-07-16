/* eslint-disable no-console */
/**
 * Backfills deployment mode flags for agents that already have active widget tokens.
 *
 * WidgetTokenGuard now enforces `deploymentSettings.embedEnabled` and
 * `deploymentSettings.restEnabled`. Existing public embeds/integrations predate
 * those flags, so active tokens must keep working after rollout.
 *
 * Usage:
 *   cd back && npx ts-node scripts/migrations/2026-07-09-backfill-widget-deployment-modes.ts
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
    const now = new Date();
    const tokenAgentIds = await db.collection('widget_tokens').distinct('agentId', {
      isActive: true,
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } }],
    });

    if (tokenAgentIds.length === 0) {
      console.log('No active widget tokens found. Nothing to backfill.');
      return;
    }

    const result = await db.collection('agents').updateMany(
      { _id: { $in: tokenAgentIds } },
      {
        $set: {
          'deploymentSettings.embedEnabled': true,
          'deploymentSettings.restEnabled': true,
        },
      },
    );

    console.log(`Backfilled widget deployment modes on ${result.modifiedCount} agents.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

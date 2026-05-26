/* eslint-disable no-console */
/**
 * One-shot migration for the conversation-v2 state-ownership rework.
 *
 * Per the design doc (docs/superpowers/specs/2026-05-25-conversation-v2-state-ownership-design.md),
 * we clean-cut: every active conversation_v2_sessions pointer is soft-deleted
 * because the AI service's session events are no longer being persisted into
 * the new conversation_v2_events collection retroactively.
 *
 * Usage:
 *   cd back && npx ts-node scripts/migrations/2026-05-25-tombstone-conversation-v2-sessions.ts
 *
 * Rollback:
 *   The script writes a JSON file (.tombstoned-ids.json) listing every id it
 *   soft-deleted; to restore, re-set deletedAt=null on those ids.
 */
import { config as loadEnv } from 'dotenv';
import { MongoClient } from 'mongodb';
import * as fs from 'node:fs';
import * as path from 'node:path';

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
    const col = db.collection('conversation_v2_sessions');
    const now = new Date();
    const cursor = col.find({ deletedAt: null }, { projection: { _id: 1, sessionId: 1 } });
    const targets: { _id: unknown; sessionId: string }[] = [];
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      if (doc) targets.push({ _id: doc._id, sessionId: doc.sessionId });
    }

    const outFile = path.join(__dirname, '.tombstoned-ids.json');
    fs.writeFileSync(outFile, JSON.stringify(targets, null, 2));
    console.log(`Snapshot of ${targets.length} target ids written to ${outFile}`);

    const result = await col.updateMany(
      { deletedAt: null },
      { $set: { deletedAt: now } },
    );
    console.log(`Tombstoned ${result.modifiedCount} sessions at ${now.toISOString()}`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

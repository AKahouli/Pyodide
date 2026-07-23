/* eslint-disable no-console */
/** Idempotently registers the native workspace file tool for admin assignment. */
import { config as loadEnv } from 'dotenv';
import { MongoClient } from 'mongodb';

async function main(): Promise<void> {
  loadEnv();
  const uri = process.env.MONGODB_URI ?? process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI not set in .env');
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    const now = new Date();
    const category = await db.collection('tool_categories').findOneAndUpdate(
      { name: 'Workspace' },
      { $setOnInsert: { name: 'Workspace', description: 'Native tools that work with workspace content.', createdAt: now }, $set: { updatedAt: now } },
      { upsert: true, returnDocument: 'after' },
    );
    await db.collection('tools').updateOne(
      { name: 'save_file_to_workspace' },
      {
        $set: {
          description: `Save an external file to a workspace from its download URL.

Use this tool after a connector or other external service returns a download URL and the file must become available in the workspace for later processing. Provide the target workspace ID, filename, and any download authorization headers supplied by the source.`,
          categoryId: category?._id ?? null,
          requiredAppKey: null,
          defaultAgentTypes: [],
          attributes: [],
          isActive: true,
          updatedAt: now,
        },
        $setOnInsert: { name: 'save_file_to_workspace', createdAt: now },
      },
      { upsert: true },
    );
    console.log('Seeded save_file_to_workspace under Workspace.');
  } finally { await client.close(); }
}

main().catch((error) => { console.error(error); process.exit(1); });

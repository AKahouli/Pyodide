/* eslint-disable no-console */
/** Idempotently registers the native lightweight JavaScript tool for explicit agent assignment. */
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
      { name: 'Execution' },
      {
        $setOnInsert: {
          name: 'Execution',
          description: 'Native tools that execute bounded workloads.',
          createdAt: now,
        },
        $set: { updatedAt: now },
      },
      { upsert: true, returnDocument: 'after' },
    );
    await db.collection('tools').updateOne(
      { name: 'run_code' },
      {
        $set: {
          description: `Run small, resource-bounded JavaScript workloads for JSON and text transformations, calculations, control flow, and authorized workspace files. QuickJS has no module loader or Node APIs: never use import, import(), require, or node:* modules. The injected async fs methods are list, glob, find, stat, readText, readJson, copy, writeText, writeJson, and remove. Start discovery with "const roots = await fs.list('/workspace');" and use returned virtual paths; never guess filenames or physical storage paths. Source workspaces and attachments are read-only, and /workspace/run is writable. glob and metadata-only find return safe logical file metadata. Use server-side copy for large/binary files instead of reading bytes through QuickJS. remove is limited to artifacts created or copied during the current execution. Code is an async function body: top-level await is allowed, and it must explicitly return a JSON-compatible value, for example with Object.fromEntries; a bare final expression is not returned.

Use mcp-manus instead for Python, shell commands, packages, large files, spreadsheets, Parquet, charts, media, binary processing, or resource-heavy work.`,
          categoryId: category?._id ?? null,
          requiredAppKey: null,
          defaultAgentTypes: [],
          attributes: [],
          isActive: true,
          updatedAt: now,
        },
        $setOnInsert: { name: 'run_code', createdAt: now },
      },
      { upsert: true },
    );
    console.log('Seeded run_code under Execution.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

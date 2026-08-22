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
          description: `Run small, resource-bounded JavaScript workloads for JSON and text transformations, calculations, control flow, and small UTF-8 text/JSON workspace files. Code runs in QuickJS, which has no module loader or Node APIs: never use import, import(), require, or node:* modules. Workspace access is available only through the injected async fs methods: list, stat, readText, readJson, writeText, and writeJson. Start with "const roots = await fs.list('/workspace');", find a source mount under /workspace/sources/..., list it, and use the returned absolute file path with fs.readText or fs.readJson; never guess a bare attachment filename. Source mounts are read-only and /workspace/run is writable. Code is an async function body: top-level await is allowed, and it must explicitly return a JSON-compatible value. Use "return { result, expression };"; a bare final expression such as "({ result, expression });" is not returned.

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

/* eslint-disable no-console */
/** Idempotently registers the native conversational choice tool for admin assignment. */
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
      { name: 'Conversational UI' },
      { $setOnInsert: { name: 'Conversational UI', description: 'Native tools that render conversational UI components.', createdAt: now }, $set: { updatedAt: now } },
      { upsert: true, returnDocument: 'after' },
    );
    await db.collection('tools').updateOne(
      { name: 'present_choices' },
      { $set: { description: 'Present a structured question with selectable answers. Use quick_replies for short immediate choices and list for descriptions, multiple selections, custom answers, or confirmation.', categoryId: category?._id ?? null, requiredAppKey: null, defaultAgentTypes: [], attributes: [], isActive: true, updatedAt: now }, $setOnInsert: { name: 'present_choices', createdAt: now } },
      { upsert: true },
    );
    console.log('Seeded present_choices under Conversational UI.');
  } finally { await client.close(); }
}

main().catch((error) => { console.error(error); process.exit(1); });

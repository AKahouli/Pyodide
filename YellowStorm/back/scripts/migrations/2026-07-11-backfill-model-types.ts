/* eslint-disable no-console */
import { config as loadEnv } from 'dotenv';
import { MongoClient } from 'mongodb';

const modelTypes = [
  'chat', 'completion', 'embedding', 'image_generation', 'audio_transcription',
  'audio_speech', 'moderation', 'guardrails_classifier', 'search',
];

async function main(): Promise<void> {
  loadEnv();
  const uri = process.env.MONGODB_URI ?? process.env.MONGO_URI;
  if (!uri) throw new Error('MONGODB_URI not set in .env');

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const result = await client.db().collection('models').updateMany(
      { type: { $in: modelTypes }, $or: [{ types: { $exists: false } }, { types: [] }] },
      [{ $set: { types: ['$type'] } }],
    );
    console.log(`Backfilled types on ${result.modifiedCount} models.`);

    const clearedDefaults = await client.db().collection('models').updateMany(
      {
        isDefault: true,
        $or: [
          { isActive: false },
          { $nor: [{ types: 'chat' }, { type: 'chat' }] },
        ],
      },
      { $set: { isDefault: false } },
    );
    console.log(`Cleared ${clearedDefaults.modifiedCount} invalid default models.`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

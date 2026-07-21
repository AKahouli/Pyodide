/**
 * Idempotent governed-conversation compatibility migration.
 * Usage: npx ts-node scripts/migrations/backfill-governed-conversations.ts --dry-run
 */
import 'dotenv/config';
import mongoose from 'mongoose';

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const scopes = await db.collection('governance_scopes').countDocuments({ audience: { $exists: false } });
  const revisions = await db.collection('governance_deployment_revisions').countDocuments({ allowedAgentIds: { $exists: false } });
  const conversations = await db.collection('conversations').countDocuments({ runtimeMode: { $exists: false } });
  console.log(JSON.stringify({ dryRun, scopes, revisions, conversations }));
  if (!dryRun) {
    await db.collection('governance_scopes').updateMany({ audience: { $exists: false } }, { $set: { audience: { mode: 'restricted', userIds: [], groupIds: [] } } });
    await db.collection('governance_deployment_revisions').updateMany({ allowedAgentIds: { $exists: false } }, [{ $set: { allowedAgentIds: ['$agentId'] } }]);
    await db.collection('conversations').updateMany({ runtimeMode: { $exists: false } }, { $set: { runtimeMode: 'standard' } });
  }
  await mongoose.disconnect();
}

void main().catch(async (error) => { console.error(error instanceof Error ? error.message : error); await mongoose.disconnect(); process.exitCode = 1; });

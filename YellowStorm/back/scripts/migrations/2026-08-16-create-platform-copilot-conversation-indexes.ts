/**
 * Creates platform-copilot creation idempotency and generic message retry indexes.
 * Usage: npx ts-node scripts/migrations/2026-08-16-create-platform-copilot-conversation-indexes.ts --dry-run
 */
import 'dotenv/config';
import mongoose from 'mongoose';

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  const dryRun = process.argv.includes('--dry-run');
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const duplicateTurns = await db.collection('messages').aggregate([
    { $match: { requestId: { $exists: true, $type: 'string' } } },
    { $match: { senderId: { $exists: true, $type: 'objectId' } } },
    { $group: { _id: { conversationId: '$conversationId', senderId: '$senderId', conversationType: '$conversationType', requestId: '$requestId' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 20 },
  ]).toArray();
  const duplicateCopilotRequests = await db.collection('conversations').aggregate([
    { $match: { runtimePurpose: 'platform_copilot', platformCopilotCreationRequestId: { $exists: true, $type: 'string' } } },
    { $group: { _id: { createdBy: '$createdBy', requestId: '$platformCopilotCreationRequestId' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 20 },
  ]).toArray();
  const conversationIndexes = await db.collection('conversations').indexes();
  const legacyCopilotIndex = conversationIndexes.find((index) => index.name === 'createdBy_1_runtimePurpose_1');
  console.log(JSON.stringify({
    dryRun,
    duplicateTurnGroups: duplicateTurns.length,
    duplicateCopilotRequestGroups: duplicateCopilotRequests.length,
    legacyCopilotIndexPresent: Boolean(legacyCopilotIndex),
  }));
  if (!dryRun) {
    if (duplicateTurns.length || duplicateCopilotRequests.length) {
      throw new Error('Resolve reported duplicate identities before creating unique indexes');
    }
    if (legacyCopilotIndex?.name) await db.collection('conversations').dropIndex(legacyCopilotIndex.name);
    await db.collection('conversations').createIndex(
      { createdBy: 1, platformCopilotCreationRequestId: 1 },
      {
        name: 'platform_copilot_creation_request_unique',
        unique: true,
        partialFilterExpression: { platformCopilotCreationRequestId: { $exists: true, $type: 'string' } },
      },
    );
    const legacyIndex = (await db.collection('messages').indexes())
      .find((index) => index.name === 'conversationId_1_conversationType_1_requestId_1');
    if (legacyIndex?.name) await db.collection('messages').dropIndex(legacyIndex.name);
    await db.collection('messages').createIndex(
      { conversationId: 1, senderId: 1, conversationType: 1, requestId: 1 },
      {
        name: 'conversation_sender_type_request_unique',
        unique: true,
        partialFilterExpression: {
          requestId: { $exists: true, $type: 'string' },
          senderId: { $exists: true, $type: 'objectId' },
        },
      },
    );
  }
  await mongoose.disconnect();
}

void main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await mongoose.disconnect();
  process.exitCode = 1;
});

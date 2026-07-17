/**
 * Backfill one immutable version for every legacy governance source.
 * Usage: npx ts-node back/scripts/backfill-governance-source-versions.ts --dry-run --program-id=<id>
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is required');
const dryRun = process.argv.includes('--dry-run');
const programId = process.argv.find((value) => value.startsWith('--program-id='))?.split('=')[1];
const batchSize = Number(process.argv.find((value) => value.startsWith('--batch-size='))?.split('=')[1] ?? '100');

const lifecycle = (status: string): string => ({ draft: 'captured', to_review: 'to_review', validated: 'approved', published: 'published', expired: 'rejected', rejected: 'rejected' }[status] ?? 'captured');
async function main(): Promise<void> {
  await mongoose.connect(uri!);
  const db = mongoose.connection.db!;
  const sources = db.collection('governance_sources');
  const versions = db.collection('governance_source_versions');
  const events = db.collection('governance_source_events');
  const filter = programId ? { programId: new mongoose.Types.ObjectId(programId) } : {};
  let processed = 0;
  for await (const source of sources.find(filter).batchSize(batchSize)) {
    const exists = await versions.findOne({ sourceId: source._id }, { projection: { _id: 1 } });
    if (exists) continue;
    const versionNumber = Number(source.versionSequence ?? 0) + 1;
    const sourceLifecycle = lifecycle(source.status);
    const version = { programId: source.programId, sourceId: source._id, versionNumber, workspaceId: source.workspaceId, documentId: source.documentId, canonicalUrl: source.url, capturedAt: source.createdAt ?? new Date(), lifecycleStatus: sourceLifecycle, technicalStatus: sourceLifecycle === 'published' ? 'ready' : 'pending', validity: { mode: 'unknown', businessStatus: 'unknown', confidence: 0, evidence: [], manuallyOverridden: false }, extractedMetadata: source.metadata ?? {}, createdAt: new Date(), updatedAt: new Date() };
    if (!dryRun) {
      const inserted = await versions.insertOne(version);
      await sources.updateOne({ _id: source._id }, { $set: { versionSequence: versionNumber, currentCandidateVersionId: inserted.insertedId, ...(sourceLifecycle === 'published' ? { currentPublishedVersionId: inserted.insertedId } : {}) } });
      await events.insertOne({ programId: source.programId, sourceId: source._id, versionId: inserted.insertedId, eventType: 'version.captured', occurredAt: new Date(), metadata: { migration: 'backfill-governance-source-versions' }, createdAt: new Date(), updatedAt: new Date() });
    }
    processed += 1;
  }
  console.log(`${dryRun ? 'Would backfill' : 'Backfilled'} ${processed} source version(s).`);
  await mongoose.disconnect();
}
main().catch((error) => { console.error(error); process.exit(1); });

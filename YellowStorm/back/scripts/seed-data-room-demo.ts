/**
 * Reproducible, explicitly fictional governed-data-room seed.
 * Usage: npx ts-node scripts/seed-data-room-demo.ts --owner-user-id=<MongoId>
 */
import mongoose, { Types } from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
const uri = process.env.MONGODB_URI;
const ownerUserId = process.argv.find((value) => value.startsWith('--owner-user-id='))?.split('=')[1];
if (!uri) throw new Error('MONGODB_URI is required');
if (!ownerUserId || !Types.ObjectId.isValid(ownerUserId)) throw new Error('--owner-user-id must be a valid MongoDB ObjectId');

const demo = { demoData: true, label: 'Fictional demo data — not for production use' };
const validity = (businessStatus: string, mode = 'unknown') => ({ mode, businessStatus, confidence: 0, evidence: [], manuallyOverridden: false });

async function main(): Promise<void> {
  await mongoose.connect(uri!);
  const db = mongoose.connection.db!;
  const ownerId = new Types.ObjectId(ownerUserId);
  const programs = db.collection('governance_programs');
  const scopes = db.collection('governance_scopes');
  const workspaces = db.collection('workspaces');
  const sources = db.collection('governance_sources');
  const versions = db.collection('governance_source_versions');
  const now = new Date();
  const program = await programs.findOneAndUpdate({ name: 'POLD Enterprises (Demo)', ownerUserId: ownerId }, { $setOnInsert: { name: 'POLD Enterprises (Demo)', description: 'Fictional Governed Data Room demonstration program.', defaultLanguage: 'fr', status: 'draft', ownerUserId: ownerId, metadata: demo, createdAt: now }, $set: { updatedAt: now } }, { upsert: true, returnDocument: 'after' });
  if (!program) throw new Error('Unable to create demo program');
  const ensureScope = async (name: string) => scopes.findOneAndUpdate({ programId: program._id, name }, { $setOnInsert: { programId: program._id, name, type: 'municipality', status: 'active', agentIds: [], metadata: demo, createdAt: now }, $set: { updatedAt: now } }, { upsert: true, returnDocument: 'after' });
  const nanterre = await ensureScope('Nanterre'); const puteaux = await ensureScope('Puteaux');
  if (!nanterre || !puteaux) throw new Error('Unable to create demo scopes');
  const ensureWorkspace = async (name: string, alias: string) => workspaces.findOneAndUpdate({ createdBy: ownerId, name }, { $setOnInsert: { name, alias, storagePrefix: alias, createdBy: ownerId, allocatedStorage: 1073741824, documentCount: 0, usedStorage: 0, isSystem: false, isPersonal: false, isPublic: false, metadata: demo, createdAt: now }, $set: { updatedAt: now } }, { upsert: true, returnDocument: 'after' });
  await ensureWorkspace('POLD Economy (Demo)', 'pold-economy-demo'); await ensureWorkspace('Nanterre Economy (Demo)', 'nanterre-economy-demo'); await ensureWorkspace('Puteaux Economy (Demo)', 'puteaux-economy-demo');
  const examples = [
    ['POLD Demo Economic Guide', 'program_shared', [], 'valid', 'open_ended'],
    ['POLD Demo Source With Unknown Validity', 'program_shared', [], 'unknown', 'unknown'],
    ['POLD Demo Expired Notice', 'scope_specific', [nanterre._id], 'expired', 'fixed_date'],
    ['POLD Demo Conflicting Guidance', 'scope_specific', [puteaux._id], 'conflicting', 'unknown'],
    ['Nanterre Demo Local Source', 'scope_specific', [nanterre._id], 'valid', 'open_ended'],
    ['POLD Demo Shared Source', 'program_shared', [], 'valid', 'open_ended'],
  ] as const;
  for (const [title, visibility, scopeIds, businessStatus, mode] of examples) {
    const originKey = `demo:${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const source = await sources.findOneAndUpdate({ programId: program._id, originKey }, { $setOnInsert: { programId: program._id, scopeIds, visibility, title, sourceType: 'manual_record', status: 'draft', tags: ['demo'], originKey, versionSequence: 1, metadata: demo, createdAt: now }, $set: { updatedAt: now } }, { upsert: true, returnDocument: 'after' });
    if (!source) continue;
    const existing = await versions.findOne({ sourceId: source._id });
    if (!existing) { const inserted = await versions.insertOne({ programId: program._id, sourceId: source._id, versionNumber: 1, capturedAt: now, lifecycleStatus: 'captured', technicalStatus: 'ready', validity: validity(businessStatus, mode), extractedMetadata: demo, createdAt: now, updatedAt: now }); await sources.updateOne({ _id: source._id }, { $set: { currentCandidateVersionId: inserted.insertedId, versionSequence: 1 } }); }
  }
  console.log(`Seeded fictional Governed Data Room demo program ${program._id.toString()}.`);
  await mongoose.disconnect();
}
main().catch((error) => { console.error(error); process.exit(1); });

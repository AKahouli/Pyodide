import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

async function main(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db!;
  const duplicateDocuments = await db.collection('governance_documents').aggregate([{ $group: { _id: { programId: '$programId', documentId: '$documentId' }, count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }, { $count: 'count' }]).next();
  const missingArtifacts = await db.collection('governance_documents').aggregate([{ $lookup: { from: 'workspace_documents', localField: 'documentId', foreignField: '_id', as: 'artifact' } }, { $match: { 'artifact.0': { $exists: false } } }, { $count: 'count' }]).next();
  const missingBindings = await db.collection('governance_documents').aggregate([{ $lookup: { from: 'governance_workspace_bindings', let: { programId: '$programId', workspaceId: '$workspaceId' }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$programId', '$$programId'] }, { $eq: ['$workspaceId', '$$workspaceId'] }, { $eq: ['$enabled', true] }] } } }], as: 'binding' } }, { $match: { 'binding.0': { $exists: false } } }, { $count: 'count' }]).next();
  const legacyKnowledgeReferences: Record<string, number> = {};
  for (const name of ['knowledge_assessments', 'knowledge_alerts', 'knowledge_recommendations', 'metadata_candidates', 'knowledge_extraction_jobs', 'temporal_candidate_records']) legacyKnowledgeReferences[name] = await db.collection(name).countDocuments({ $or: [{ sourceId: { $exists: true } }, { sourceVersionId: { $exists: true } }] });
  const legacyDeploymentRevisionReferences = await db.collection('governance_deployment_revisions').countDocuments({ $or: [{ sourceIds: { $exists: true } }, { includedSourceIds: { $exists: true } }, { excludedSourceIds: { $exists: true } }, { sourceSnapshot: { $exists: true } }] });
  const result = { duplicateGovernanceDocuments: duplicateDocuments?.count ?? 0, governanceDocumentsWithoutArtifacts: missingArtifacts?.count ?? 0, governanceDocumentsWithoutEnabledBindings: missingBindings?.count ?? 0, legacyDeploymentRevisionReferences, legacyKnowledgeReferences };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  await mongoose.disconnect();
  if (result.duplicateGovernanceDocuments || result.governanceDocumentsWithoutArtifacts || result.governanceDocumentsWithoutEnabledBindings || result.legacyDeploymentRevisionReferences || Object.values(legacyKnowledgeReferences).some(Boolean)) process.exitCode = 1;
}

main().catch(async (error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); await mongoose.disconnect(); process.exitCode = 1; });

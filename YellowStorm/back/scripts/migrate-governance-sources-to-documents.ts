/**
 * Migrates legacy governance source aggregates to document governance overlays.
 * Defaults to dry-run. Legacy collections are never dropped or rewritten.
 */
import mongoose, { Document, Types } from 'mongoose';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

type Preference = 'candidate' | 'published';
type ObjectId = Types.ObjectId;
interface Options { apply: boolean; reportPath: string; batchSize: number; resumeFrom?: ObjectId; preference?: Preference }
interface LegacySource extends Document { _id: ObjectId; programId: ObjectId; scopeIds?: ObjectId[]; visibility?: 'program_shared' | 'scope_specific' | 'multi_scope'; workspaceId?: ObjectId; documentId?: ObjectId; currentCandidateVersionId?: ObjectId; currentPublishedVersionId?: ObjectId; status?: string; tags?: string[]; metadata?: Record<string, unknown>; ownerUserId?: ObjectId; ownerScopeId?: ObjectId; reviewFrequencyDays?: number; isArchived?: boolean; archivedAt?: Date; archivedBy?: ObjectId; archiveReason?: string; createdAt?: Date; updatedAt?: Date }
interface LegacyVersion extends Document { _id: ObjectId; programId: ObjectId; sourceId: ObjectId; workspaceId?: ObjectId; documentId?: ObjectId; lifecycleStatus?: string; validity?: Record<string, unknown>; submittedForReviewBy?: ObjectId; submittedForReviewAt?: Date; reviewedBy?: ObjectId; reviewedAt?: Date; approvedBy?: ObjectId; approvedAt?: Date; publishedBy?: ObjectId; publishedAt?: Date; reviewComment?: string; createdAt?: Date; updatedAt?: Date }
interface Mapping { sourceId: ObjectId; versionId?: ObjectId; programId: ObjectId; documentId: ObjectId; workspaceId?: ObjectId; governanceDocumentId?: ObjectId }
interface DeploymentRevisionPlan { revisionId: ObjectId; workspaceIds: ObjectId[] }
interface WorkspaceBindingPlan { programId: ObjectId; workspaceId: ObjectId; visibility: 'program_shared' | 'scope_specific' | 'multi_scope'; scopeIds: ObjectId[]; createdBy: ObjectId; exists: boolean }
interface Conflict { sourceId?: string; programId?: string; documentId?: string; type: string; message: string }
interface MigrationReport {
  mode: 'dry-run' | 'apply';
  startedAt: string;
  completedAt?: string;
  options: { batchSize: number; resumeFrom?: string; preference?: Preference };
  totalSources: number;
  totalSourceVersions: number;
  sourcesWithoutDocument: number;
  sourcesWithCandidateOnly: number;
  sourcesWithPublishedOnly: number;
  sourcesWithPublishedAndCandidate: number;
  sourcesWithNoEffectiveVersion: number;
  duplicateSourcesForProgramAndDocument: number;
  conflictingVisibilityAssignments: number;
  missingWorkspaceDocuments: number;
  workspaceIdMismatches: number;
  deploymentRevisionsReferencingSources: number;
  knowledgeRecordsReferencingMissingSources: number;
  migratedGovernanceDocuments: number;
  migratedEvents: number;
  migratedKnowledgeRecords: number;
  migratedPermissions: number;
  migratedDeploymentRevisions: number;
  migratedWorkspaceBindings: number;
  conflicts: Conflict[];
}

const options = parseOptions(process.argv.slice(2));
const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI is required');

function parseOptions(args: string[]): Options {
  const apply = args.includes('--apply');
  if (apply && args.includes('--dry-run')) throw new Error('Choose either --dry-run or --apply');
  const reportPath = value(args, '--report') ?? path.resolve(process.cwd(), 'governance-document-migration-report.json');
  const batchSize = Number(value(args, '--batch-size') ?? '100');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error('--batch-size must be an integer between 1 and 1000');
  const resume = value(args, '--resume-from');
  if (resume && !Types.ObjectId.isValid(resume)) throw new Error('--resume-from must be a MongoDB ObjectId');
  const candidate = args.includes('--prefer-candidate');
  const published = args.includes('--prefer-published');
  if (candidate && published) throw new Error('Choose only one conflict preference');
  if ((candidate || published) && process.env.NODE_ENV === 'production') throw new Error('Conflict preference flags are disabled in production');
  return { apply, reportPath, batchSize, resumeFrom: resume ? new Types.ObjectId(resume) : undefined, preference: candidate ? 'candidate' : published ? 'published' : undefined };
}

function value(args: string[], name: string): string | undefined { return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1); }
function lifecycle(value?: string, archived = false): string { if (archived) return 'archived'; return ({ draft: 'captured', captured: 'captured', to_review: 'to_review', validated: 'approved', approved: 'approved', published: 'published', rejected: 'rejected', expired: 'rejected' } as Record<string, string>)[value ?? ''] ?? 'captured'; }
async function resolve(source: LegacySource, versions: mongoose.mongo.Collection<LegacyVersion>, report: MigrationReport): Promise<{ mapping?: Mapping; version?: LegacyVersion }> {
  const candidate = source.currentCandidateVersionId ? await versions.findOne({ _id: source.currentCandidateVersionId, sourceId: source._id }) : null;
  const published = source.currentPublishedVersionId ? await versions.findOne({ _id: source.currentPublishedVersionId, sourceId: source._id }) : null;
  if (candidate) report.sourcesWithCandidateOnly += published ? 0 : 1;
  if (published) report.sourcesWithPublishedOnly += candidate ? 0 : 1;
  if (candidate && published) report.sourcesWithPublishedAndCandidate += 1;
  if (candidate?.documentId && published?.documentId && !candidate.documentId.equals(published.documentId) && !options.preference) {
    report.conflicts.push({ sourceId: source._id.toString(), programId: source.programId.toString(), type: 'published_candidate_conflict', message: 'Published and candidate versions reference different workspace documents' });
    return {};
  }
  let selected = options.preference === 'published' ? published : options.preference === 'candidate' ? candidate : candidate ?? published;
  if (!selected) selected = await versions.findOne({ sourceId: source._id, lifecycleStatus: { $nin: ['rejected', 'superseded'] } }, { sort: { createdAt: -1 } }) ?? await versions.findOne({ sourceId: source._id }, { sort: { createdAt: -1 } });
  const documentId = selected?.documentId ?? source.documentId;
  if (!selected) report.sourcesWithNoEffectiveVersion += 1;
  if (!documentId) { report.sourcesWithoutDocument += 1; report.conflicts.push({ sourceId: source._id.toString(), programId: source.programId.toString(), type: 'missing_document_id', message: 'No workspace document can be resolved' }); return {}; }
  return { mapping: { sourceId: source._id, versionId: selected?._id, programId: source.programId, documentId }, version: selected ?? undefined };
}

async function main(): Promise<void> {
  await mongoose.connect(uri!);
  const db = mongoose.connection.db!;
  const sources = db.collection<LegacySource>('governance_sources');
  const versions = db.collection<LegacyVersion>('governance_source_versions');
  const workspaceDocuments = db.collection('workspace_documents');
  const governanceDocuments = db.collection('governance_documents');
  const report: MigrationReport = { mode: options.apply ? 'apply' : 'dry-run', startedAt: new Date().toISOString(), options: { batchSize: options.batchSize, resumeFrom: options.resumeFrom?.toString(), preference: options.preference }, totalSources: await sources.countDocuments(), totalSourceVersions: await versions.countDocuments(), sourcesWithoutDocument: 0, sourcesWithCandidateOnly: 0, sourcesWithPublishedOnly: 0, sourcesWithPublishedAndCandidate: 0, sourcesWithNoEffectiveVersion: 0, duplicateSourcesForProgramAndDocument: 0, conflictingVisibilityAssignments: 0, missingWorkspaceDocuments: 0, workspaceIdMismatches: 0, deploymentRevisionsReferencingSources: await db.collection('governance_deployment_revisions').countDocuments({ $or: [{ sourceIds: { $exists: true, $ne: [] } }, { includedSourceIds: { $exists: true, $ne: [] } }, { excludedSourceIds: { $exists: true, $ne: [] } }, { sourceSnapshot: { $exists: true } }] }), knowledgeRecordsReferencingMissingSources: 0, migratedGovernanceDocuments: 0, migratedEvents: 0, migratedKnowledgeRecords: 0, migratedPermissions: 0, migratedDeploymentRevisions: 0, migratedWorkspaceBindings: 0, conflicts: [] };
  const mappings: Mapping[] = [];
  const identityOwners = new Map<string, LegacySource>();
  const bindingSources = new Map<string, { programId: ObjectId; workspaceId: ObjectId; shared: boolean; scopeIds: Map<string, ObjectId> }>();
  const filter = options.resumeFrom ? { _id: { $gte: options.resumeFrom } } : {};
  for await (const source of sources.find(filter).sort({ _id: 1 }).batchSize(options.batchSize)) {
    const resolved = await resolve(source, versions, report);
    if (!resolved.mapping) continue;
    const artifact = await workspaceDocuments.findOne({ _id: resolved.mapping.documentId, isFolder: { $ne: true } }, { projection: { workspaceId: 1 } });
    if (!artifact) { report.missingWorkspaceDocuments += 1; report.conflicts.push({ sourceId: source._id.toString(), documentId: resolved.mapping.documentId.toString(), type: 'missing_workspace_document', message: 'Referenced WorkspaceDoc does not exist' }); continue; }
    if ((source.workspaceId && !source.workspaceId.equals(artifact.workspaceId as ObjectId)) || (resolved.version?.workspaceId && !resolved.version.workspaceId.equals(artifact.workspaceId as ObjectId))) { report.workspaceIdMismatches += 1; report.conflicts.push({ sourceId: source._id.toString(), documentId: resolved.mapping.documentId.toString(), type: 'workspace_mismatch', message: 'Legacy workspace identifiers disagree with WorkspaceDoc.workspaceId' }); continue; }
    const key = `${source.programId}:${resolved.mapping.documentId}`;
    const owner = identityOwners.get(key);
    if (owner) { report.duplicateSourcesForProgramAndDocument += 1; report.conflicts.push({ sourceId: source._id.toString(), programId: source.programId.toString(), documentId: resolved.mapping.documentId.toString(), type: 'duplicate_conflict', message: 'Multiple legacy sources resolve to the same program and document; lossless overlay selection is ambiguous' }); continue; }
    identityOwners.set(key, source);
    resolved.mapping.workspaceId = artifact.workspaceId as ObjectId;
    mappings.push(resolved.mapping);
    const bindingKey = `${source.programId}:${String(artifact.workspaceId)}`;
    const bindingSource = bindingSources.get(bindingKey) ?? { programId: source.programId, workspaceId: artifact.workspaceId as ObjectId, shared: false, scopeIds: new Map<string, ObjectId>() };
    bindingSource.shared ||= source.visibility === 'program_shared';
    for (const scopeId of source.scopeIds ?? []) bindingSource.scopeIds.set(scopeId.toString(), scopeId);
    if (source.ownerScopeId) bindingSource.scopeIds.set(source.ownerScopeId.toString(), source.ownerScopeId);
    bindingSources.set(bindingKey, bindingSource);
  }
  const workspaceBindingPlans = await planWorkspaceBindings(db, bindingSources, report);
  const deploymentRevisionPlans = await planDeploymentRevisions(db, sources, report);
  if (report.conflicts.length > 0) { report.completedAt = new Date().toISOString(); writeReports(report); if (options.apply) throw new Error(`Migration blocked by ${report.conflicts.length} conflict(s); no dependent records were migrated`); await mongoose.disconnect(); return; }
  if (options.apply) {
    report.migratedWorkspaceBindings = await migrateWorkspaceBindings(db, workspaceBindingPlans);
    for (const mapping of mappings) {
      const source = await sources.findOne({ _id: mapping.sourceId });
      const version = mapping.versionId ? await versions.findOne({ _id: mapping.versionId, sourceId: mapping.sourceId }) : null;
      const artifact = await workspaceDocuments.findOne({ _id: mapping.documentId }, { projection: { workspaceId: 1 } });
      if (!source || !artifact) throw new Error(`Preflight target disappeared for source ${mapping.sourceId.toString()}`);
      const now = new Date();
      const result = await governanceDocuments.updateOne({ programId: source.programId, documentId: mapping.documentId }, { $setOnInsert: { programId: source.programId, documentId: mapping.documentId, workspaceId: artifact.workspaceId, status: lifecycle(version?.lifecycleStatus ?? source.status, source.isArchived), validity: version?.validity ?? { mode: 'unknown', businessStatus: 'unknown', confidence: 0, evidence: [], manuallyOverridden: false }, tags: source.tags ?? [], metadata: { ...(source.metadata ?? {}), migration: { legacySourceId: source._id.toString(), legacySourceVersionId: version?._id.toString(), migratedAt: now } }, ownerUserId: source.ownerUserId, ownerScopeId: source.ownerScopeId, governanceRevision: 0, temporalDecisionRevision: 0, submittedForReviewBy: version?.submittedForReviewBy, submittedForReviewAt: version?.submittedForReviewAt, reviewedBy: version?.reviewedBy, reviewedAt: version?.reviewedAt, approvedBy: version?.approvedBy, approvedAt: version?.approvedAt, publishedBy: version?.publishedBy, publishedAt: version?.publishedAt, reviewComment: version?.reviewComment, archivedAt: source.archivedAt, archivedBy: source.archivedBy, archiveReason: source.archiveReason, createdAt: source.createdAt ?? now }, $set: { workspaceId: artifact.workspaceId, updatedAt: now } }, { upsert: true });
      const governed = await governanceDocuments.findOne({ programId: source.programId, documentId: mapping.documentId }, { projection: { _id: 1 } });
      mapping.governanceDocumentId = governed?._id as ObjectId | undefined;
      report.migratedGovernanceDocuments += result.upsertedCount;
      report.migratedEvents += await migrateEvents(db, mapping);
      report.migratedKnowledgeRecords += await migrateKnowledge(db, mapping);
    }
    report.migratedPermissions = await migratePermissions(db);
    report.migratedDeploymentRevisions = await migrateDeploymentRevisions(db, deploymentRevisionPlans);
  }
  report.completedAt = new Date().toISOString();
  writeReports(report);
  await mongoose.disconnect();
}

async function planWorkspaceBindings(db: mongoose.mongo.Db, sourcesByWorkspace: Map<string, { programId: ObjectId; workspaceId: ObjectId; shared: boolean; scopeIds: Map<string, ObjectId> }>, report: MigrationReport): Promise<WorkspaceBindingPlan[]> {
  const bindings = db.collection('governance_workspace_bindings');
  const programs = db.collection('governance_programs');
  const scopes = db.collection('governance_scopes');
  const plans: WorkspaceBindingPlan[] = [];
  for (const source of sourcesByWorkspace.values()) {
    const scopeIds = [...source.scopeIds.values()].sort((a, b) => a.toString().localeCompare(b.toString()));
    const visibility = source.shared ? 'program_shared' : scopeIds.length > 1 ? 'multi_scope' : 'scope_specific';
    const expectedScopeIds = visibility === 'program_shared' ? [] : scopeIds;
    if (visibility !== 'program_shared' && expectedScopeIds.length === 0) {
      report.conflictingVisibilityAssignments += 1;
      report.conflicts.push({ programId: source.programId.toString(), type: 'workspace_binding_scope_missing', message: `Scoped legacy sources for workspace ${source.workspaceId.toString()} do not identify a scope` });
      continue;
    }
    let invalidScope = false;
    for (const scopeId of expectedScopeIds) {
      if (await scopes.countDocuments({ _id: scopeId, programId: source.programId }, { limit: 1 }) === 0) {
        report.conflictingVisibilityAssignments += 1;
        report.conflicts.push({ programId: source.programId.toString(), type: 'workspace_binding_scope_invalid', message: `Scope ${scopeId.toString()} for workspace ${source.workspaceId.toString()} is missing or belongs to another program` });
        invalidScope = true;
      }
    }
    if (invalidScope) continue;
    const existing = await bindings.findOne({ programId: source.programId, workspaceId: source.workspaceId });
    if (existing) {
      const existingScopes = ((existing.scopeIds as ObjectId[] | undefined) ?? []).map(String).sort();
      if (existing.enabled !== true || existing.visibility !== visibility || JSON.stringify(existingScopes) !== JSON.stringify(expectedScopeIds.map(String))) {
        report.conflictingVisibilityAssignments += 1;
        report.conflicts.push({ programId: source.programId.toString(), type: 'workspace_binding_conflict', message: `Existing binding for workspace ${source.workspaceId.toString()} does not preserve legacy visibility` });
      }
      plans.push({ programId: source.programId, workspaceId: source.workspaceId, visibility, scopeIds: expectedScopeIds, createdBy: existing.createdBy as ObjectId, exists: true });
      continue;
    }
    const program = await programs.findOne({ _id: source.programId }, { projection: { ownerUserId: 1 } });
    if (!program?.ownerUserId) {
      report.conflicts.push({ programId: source.programId.toString(), type: 'workspace_binding_owner_missing', message: `Program owner is required to create binding for workspace ${source.workspaceId.toString()}` });
      continue;
    }
    plans.push({ programId: source.programId, workspaceId: source.workspaceId, visibility, scopeIds: expectedScopeIds, createdBy: program.ownerUserId as ObjectId, exists: false });
  }
  return plans;
}

async function migrateWorkspaceBindings(db: mongoose.mongo.Db, plans: WorkspaceBindingPlan[]): Promise<number> {
  let inserted = 0;
  const bindings = db.collection('governance_workspace_bindings');
  for (const plan of plans) {
    if (plan.exists) continue;
    const now = new Date();
    const result = await bindings.updateOne({ programId: plan.programId, workspaceId: plan.workspaceId }, { $setOnInsert: { programId: plan.programId, workspaceId: plan.workspaceId, visibility: plan.visibility, scopeIds: plan.scopeIds, enabled: true, ingestionMode: 'assisted', defaults: {}, createdBy: plan.createdBy, createdAt: now, updatedAt: now } }, { upsert: true });
    inserted += result.upsertedCount;
  }
  return inserted;
}

async function planDeploymentRevisions(db: mongoose.mongo.Db, sources: mongoose.mongo.Collection<LegacySource>, report: MigrationReport): Promise<DeploymentRevisionPlan[]> {
  const revisions = db.collection('governance_deployment_revisions');
  const plans: DeploymentRevisionPlan[] = [];
  for await (const revision of revisions.find({ $or: [{ sourceIds: { $exists: true } }, { includedSourceIds: { $exists: true } }, { excludedSourceIds: { $exists: true } }, { sourceSnapshot: { $exists: true } }] }).batchSize(options.batchSize)) {
    const sourceIds = (revision.sourceIds as ObjectId[] | undefined) ?? [];
    const included = (revision.includedSourceIds as ObjectId[] | undefined) ?? [];
    const excluded = new Set(((revision.excludedSourceIds as ObjectId[] | undefined) ?? []).map(String));
    const effectiveSourceIds = [...new Map([...sourceIds, ...included].filter((id) => !excluded.has(String(id))).map((id) => [String(id), id])).values()];
    const workspaceIds = new Map<string, ObjectId>(((revision.workspaceIds as ObjectId[] | undefined) ?? []).map((id) => [String(id), id]));
    for (const sourceId of effectiveSourceIds) {
      const source = await sources.findOne({ _id: sourceId }, { projection: { workspaceId: 1 } });
      if (!source?.workspaceId) {
        report.conflicts.push({ sourceId: String(sourceId), type: 'deployment_revision_source_unresolved', message: `Deployment revision ${revision._id.toString()} references a source without a workspace` });
        continue;
      }
      workspaceIds.set(source.workspaceId.toString(), source.workspaceId);
    }
    plans.push({ revisionId: revision._id as ObjectId, workspaceIds: [...workspaceIds.values()] });
  }
  return plans;
}

async function migrateDeploymentRevisions(db: mongoose.mongo.Db, plans: DeploymentRevisionPlan[]): Promise<number> {
  let modified = 0;
  const revisions = db.collection('governance_deployment_revisions');
  for (const plan of plans) {
    const result = await revisions.updateOne({ _id: plan.revisionId }, { $set: { workspaceIds: plan.workspaceIds }, $unset: { sourceIds: '', includedSourceIds: '', excludedSourceIds: '', sourceSnapshot: '' } });
    modified += result.modifiedCount;
  }
  return modified;
}

async function migrateEvents(db: mongoose.mongo.Db, mapping: Mapping): Promise<number> {
  if (!mapping.governanceDocumentId) return 0;
  const legacy = db.collection('governance_source_events');
  const target = db.collection('governance_document_events');
  let count = 0;
  const eventMap: Record<string, string | undefined> = { 'source.created': 'document.governance_created', 'source.archived': 'document.archived', 'source.restored': 'document.restored', 'source.permanently_deleted': 'document.governance_deleted', 'version.captured': 'document.captured', 'version.submitted_for_review': 'document.submitted_for_review', 'version.returned_to_editing': 'document.returned_to_editing', 'version.approved': 'document.approved', 'version.rejected': 'document.rejected', 'version.published': 'document.published', 'validity.updated': 'validity.updated', 'validity.review_due': 'validity.review_due', 'validity.candidate_decided': 'validity.candidate_decided', 'knowledge.assessed': 'knowledge.assessed', 'knowledge.recommendation_applied': 'knowledge.recommendation_applied', 'metadata.candidate_decided': 'metadata.candidate_decided' };
  for await (const event of legacy.find({ sourceId: mapping.sourceId }).batchSize(options.batchSize)) {
    const eventType = eventMap[String(event.eventType)];
    if (!eventType) continue;
    const deduplicationKey = `migration:${event._id.toString()}`;
    const result = await target.updateOne({ governanceDocumentId: mapping.governanceDocumentId, deduplicationKey }, { $setOnInsert: { programId: mapping.programId, governanceDocumentId: mapping.governanceDocumentId, documentId: mapping.documentId, eventType, actorId: event.actorId, actorType: event.actorType ?? 'system', actorEmail: event.actorEmail, occurredAt: event.occurredAt ?? event.createdAt ?? new Date(), reason: event.reason, before: event.before, after: event.after, metadata: { ...(event.metadata ?? {}), legacyEventId: event._id.toString() }, correlationId: event.correlationId, causationId: event.causationId, deduplicationKey, createdAt: event.createdAt ?? new Date(), updatedAt: event.updatedAt ?? new Date() } }, { upsert: true });
    count += result.upsertedCount;
  }
  return count;
}

async function migrateKnowledge(db: mongoose.mongo.Db, mapping: Mapping): Promise<number> {
  let count = 0;
  for (const name of ['knowledge_assessments', 'knowledge_alerts', 'knowledge_recommendations', 'metadata_candidates', 'knowledge_extraction_jobs', 'temporal_candidate_records']) {
    const collection = db.collection(name);
    const result = await collection.updateMany({ $or: [{ sourceId: mapping.sourceId }, ...(mapping.versionId ? [{ sourceVersionId: mapping.versionId }] : [])] }, { $set: { documentId: mapping.documentId }, $unset: { sourceId: '', sourceVersionId: '' } });
    count += result.modifiedCount;
  }
  return count;
}

async function migratePermissions(db: mongoose.mongo.Db): Promise<number> {
  let modified = 0;
  for (const collectionName of ['roles', 'authorization_roles']) {
    const collection = db.collection(collectionName);
    const roles = collection.find({ permissions: { $in: ['governance.sources.edit', 'governance.sources.review'] } }).batchSize(options.batchSize);
    for await (const role of roles) {
      const permissions = Array.from(new Set((role.permissions as string[]).map((permission) => permission === 'governance.sources.edit' ? 'governance.documents.edit' : permission === 'governance.sources.review' ? 'governance.documents.review' : permission)));
      modified += (await collection.updateOne({ _id: role._id }, { $set: { permissions } })).modifiedCount;
    }
  }
  return modified;
}

function writeReports(report: MigrationReport): void {
  fs.mkdirSync(path.dirname(options.reportPath), { recursive: true });
  fs.writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const markdownPath = options.reportPath.replace(/\.json$/i, '') + '.md';
  const rows = Object.entries(report).filter(([, value]) => typeof value === 'number').map(([key, value]) => `| ${key} | ${value} |`).join('\n');
  fs.writeFileSync(markdownPath, `# Governance Document Migration Report\n\n- Mode: ${report.mode}\n- Started: ${report.startedAt}\n- Completed: ${report.completedAt ?? 'incomplete'}\n- Blocking conflicts: ${report.conflicts.length}\n\n| Metric | Count |\n|---|---:|\n${rows}\n\n## Conflicts\n\n${report.conflicts.map((conflict) => `- ${conflict.type}: ${conflict.message} (${conflict.sourceId ?? 'n/a'})`).join('\n') || 'None'}\n`, 'utf8');
  process.stdout.write(`${report.mode} report written to ${options.reportPath}; conflicts=${report.conflicts.length}\n`);
}

main().catch(async (error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); await mongoose.disconnect(); process.exitCode = 1; });

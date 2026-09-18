/**
 * Step 0.12 — read-only Mongo inventory for the PostgreSQL migration.
 *
 * Reports document counts for the 20 in-scope collections plus orphan counts
 * for the structural ref edges (user-owner edges are checked by each step's
 * backfill script, which declares its own edges).
 *
 * Usage: npx ts-node back/scripts/migrate/inventory.ts
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { reportOrphans, type OrphanEdge } from './orphans';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const IN_SCOPE = [
  'projects',
  'project-shares',
  'workspace_artifacts',
  'workspaces',
  'workspace_settings',
  'workspace_documents',
  'workspace-shares',
  'upload_sessions',
  'governance_programs',
  'governance_scopes',
  'governance_documents',
  'governance_document_events',
  'governance_workspace_bindings',
  'governance_reconciliation_runs',
  'governance_memberships',
  'governance_deployments',
  'governance_deployment_revisions',
  'governance_dry_runs',
  'governance_metrics',
  'governance_publication_attempts',
];

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  await mongoose.connect(uri);
  const mdb = mongoose.connection.db!;
  const col = (name: string): mongoose.mongo.Collection => mdb.collection(name);

  const counts: Record<string, number> = {};
  for (const name of IN_SCOPE) counts[name] = await col(name).countDocuments();
  console.log('=== document counts ===');
  console.log(JSON.stringify(counts, null, 2));

  const idSet = async (name: string): Promise<Set<string>> =>
    new Set((await col(name).find({}, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id)));
  const [workspaceIds, documentIds, projectIds] = await Promise.all([
    idSet('workspaces'),
    idSet('workspace_documents'),
    idSet('projects'),
  ]);
  const among = (target: Set<string>) => async (ids: string[]): Promise<Set<string>> =>
    new Set(ids.filter((id) => target.has(id)));

  type Edge = OrphanEdge & { source: string };
  const edges: Edge[] = [
    { source: 'project-shares', label: 'project-shares.projectId → projects', path: 'projectId', exists: among(projectIds) },
    { source: 'workspace_artifacts', label: 'workspace_artifacts.workspaceId → workspaces', path: 'workspaceId', exists: among(workspaceIds) },
    { source: 'workspace_artifacts', label: 'workspace_artifacts.primarySource.documentId → workspace_documents', path: 'primarySource.documentId', exists: among(documentIds) },
    { source: 'workspace-shares', label: 'workspace-shares.workspaceId → workspaces', path: 'workspaceId', exists: among(workspaceIds) },
    { source: 'workspace_documents', label: 'workspace_documents.workspaceId → workspaces', path: 'workspaceId', exists: among(workspaceIds) },
    { source: 'workspace_documents', label: 'workspace_documents.parentId → workspace_documents', path: 'parentId', exists: among(documentIds) },
    { source: 'governance_documents', label: 'governance_documents.workspaceId → workspaces', path: 'workspaceId', exists: among(workspaceIds) },
    { source: 'governance_documents', label: 'governance_documents.documentId → workspace_documents', path: 'documentId', exists: among(documentIds) },
  ];

  console.log('=== orphan counts (structural refs) ===');
  const bySource = new Map<string, OrphanEdge[]>();
  for (const { source, ...edge } of edges) {
    bySource.set(source, [...(bySource.get(source) ?? []), edge]);
  }
  for (const [source, sourceEdges] of bySource) {
    const report = await reportOrphans(col(source), sourceEdges);
    for (const item of report) {
      console.log(JSON.stringify({ edge: item.label, orphanDocs: item.orphanDocs, sample: item.sample }));
    }
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

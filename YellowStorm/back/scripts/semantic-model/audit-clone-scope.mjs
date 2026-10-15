// WP04.7 — read-only historical-clone reconciliation audit (SEC-05).
//
// Flags clones whose source links/mappings the clone owner can no longer read,
// and clones whose copied revisions carry provenance from workspaces outside
// the owner's current access. Produces clone/model/workspace IDs and counts
// only — never document values. No writes, no cleanup: review the output and
// act through reviewed, backed-up operations.
//
// Usage:
//   node --env-file=YellowStorm/back/.env YellowStorm/back/scripts/semantic-model/audit-clone-scope.mjs

import process from 'node:process';
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  host: process.env.SEMANTIC_PG_HOST,
  port: Number(process.env.SEMANTIC_PG_PORT || 5432),
  user: process.env.SEMANTIC_PG_USER,
  password: process.env.SEMANTIC_PG_PASSWORD,
  database: process.env.SEMANTIC_PG_DATABASE,
  ssl: process.env.SEMANTIC_PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

async function ownerAccessibleWorkspaces(client, ownerId) {
  const { rows } = await client.query(
    `SELECT id FROM workspace.workspaces WHERE created_by = $1
     UNION
     SELECT s.workspace_id FROM workspace.workspace_shares s WHERE s.shared_with_user_id = $1
     UNION
     SELECT id FROM workspace.workspaces WHERE is_public`, [ownerId]);
  return new Set(rows.map((row) => row.id));
}

async function main() {
  const client = await pool.connect();
  try {
    const clones = await client.query(
      `SELECT DISTINCT e.model_id AS clone_id, e.payload->>'sourceModelId' AS source_id
       FROM semantic_model.events e WHERE e.event_type = 'model.cloned'`);
    if (!clones.rows.length) {
      console.log(JSON.stringify({ clones: 0, flagged: 0, findings: [] }));
      return;
    }
    const cloneIds = clones.rows.map((row) => row.clone_id);
    const owners = await client.query(
      `SELECT DISTINCT model_id, user_id FROM semantic_model.memberships
       WHERE role = 'owner' AND model_id = ANY($1::uuid[])`, [cloneIds]);
    const ownerByClone = new Map(owners.rows.map((row) => [row.model_id, row.user_id]));
    const accessCache = new Map();

    const refs = await client.query(
      `SELECT model_id, workspace_id, 'workspace_link' AS kind FROM semantic_model.workspace_links WHERE model_id = ANY($1::uuid[])
       UNION ALL
       SELECT model_id, workspace_id, 'source_mapping' AS kind FROM semantic_model.source_mappings WHERE model_id = ANY($1::uuid[])`,
      [cloneIds]);
    const refsByClone = new Map();
    for (const row of refs.rows) {
      if (!refsByClone.has(row.model_id)) refsByClone.set(row.model_id, []);
      refsByClone.get(row.model_id).push(row);
    }

    const revisions = await client.query(
      `SELECT model_id,
              jsonb_path_query_array(source_observations, '$[*].assetRef.workspaceId') AS observed
       FROM semantic_population.data_revisions WHERE model_id = ANY($1::uuid[])`, [cloneIds]);
    const provenance = await client.query(
      `SELECT r.model_id, LOWER(s.workspace_id) AS workspace_id FROM semantic_population.data_revisions r,
       LATERAL (SELECT DISTINCT e -> 'assetRef' ->> 'workspaceId' AS workspace_id
                FROM semantic_population.entities ent, jsonb_array_elements(ent.provenance -> 'sources') e
                WHERE ent.data_revision_id = r.id AND e -> 'assetRef' ->> 'workspaceId' IS NOT NULL) s
       WHERE r.model_id = ANY($1::uuid[])`, [cloneIds]);

    const findings = [];
    for (const clone of clones.rows) {
      const ownerId = ownerByClone.get(clone.clone_id);
      if (!ownerId) {
        findings.push({ cloneId: clone.clone_id, sourceModelId: clone.source_id, finding: 'no_owner_membership' });
        continue;
      }
      if (!accessCache.has(ownerId)) accessCache.set(ownerId, await ownerAccessibleWorkspaces(client, ownerId));
      const accessible = accessCache.get(ownerId);

      const rowRefs = refsByClone.get(clone.clone_id) ?? [];
      const inaccessibleKinds = {};
      const outsideWorkspaces = new Set();
      for (const ref of rowRefs) {
        if (!accessible.has(ref.workspace_id)) {
          inaccessibleKinds[ref.kind] = (inaccessibleKinds[ref.kind] ?? 0) + 1;
          outsideWorkspaces.add(ref.workspace_id);
        }
      }

      let revisionsOutside = 0;
      for (const revision of revisions.rows.filter((row) => row.model_id === clone.clone_id)) {
        // node-postgres already decodes jsonb; only plain-text deployments need a parse.
        const observedRaw = revision.observed ?? [];
        const observed = (Array.isArray(observedRaw) ? observedRaw : JSON.parse(observedRaw))
          .map((value) => String(value).toLowerCase());
        const provenanceWorkspaces = provenance.rows
          .filter((row) => row.model_id === clone.clone_id)
          .map((row) => String(row.workspace_id).toLowerCase());
        const outside = [...observed, ...provenanceWorkspaces].filter((id) => id && !accessible.has(id));
        if (outside.length) {
          revisionsOutside += 1;
          outside.forEach((id) => outsideWorkspaces.add(id));
        }
      }

      if (Object.keys(inaccessibleKinds).length || revisionsOutside) {
        findings.push({
          cloneId: clone.clone_id,
          sourceModelId: clone.source_id,
          ownerId,
          inaccessibleWorkspaceLinks: inaccessibleKinds.workspace_link ?? 0,
          inaccessibleSourceMappings: inaccessibleKinds.source_mapping ?? 0,
          revisionsWithOutsideProvenance: revisionsOutside,
          outsideWorkspaceIds: [...outsideWorkspaces].sort(),
        });
      }
    }
    console.log(JSON.stringify({ clones: clones.rows.length, flagged: findings.length, findings }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Audit failed:', error.message);
  process.exit(1);
});

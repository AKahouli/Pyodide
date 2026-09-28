/**
 * Mongo → Postgres mapping of the playbook definitions (roadmap P5, package A1): the `flows`
 * collection → playbook.flows + playbook.flow_workspaces, and `shared_playbooks` →
 * playbook.shared_playbooks. Kept apart from the runner so a spec can drive the same mapping,
 * validation and insert with fabricated documents.
 *
 * A unit is one Postgres row keyed by the Postgres column names; `columns` is both the insert list
 * and the checksum read-back list. A flow's workspace ids ride along as a non-enumerable property
 * (not part of the checksum) and are inserted in the same statement as the flow.
 */
import { stripNul } from '../../src/common/postgres/json';
import { DEFAULT_DESIGN_SETTINGS, DEFAULT_FLOW_SETTINGS, castHitlPolicy } from '../../src/modules/playbook-flow/persistence/flow-cast';
import { BackfillError, type MongoDoc } from './harness';

export type Row = Record<string, unknown>;

/** Ids present in Postgres (plus those accepted by earlier passes): the foreign keys reject a row whose parent is gone. */
export interface PlaybookFlowRefs {
  users: ReadonlySet<string>;
  workspaces: ReadonlySet<string>;
  flows: ReadonlySet<string>;
}

export interface Queryable {
  query: (sql: string, values?: unknown[]) => Promise<unknown>;
}

const HEX = /^[0-9a-f]{24}$/;
const d = (v: unknown): Date | null => {
  if (v == null) return null;
  const date = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(date.getTime()) ? null : date;
};
const dNow = (v: unknown): Date => d(v) ?? new Date();
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const sDefault = (v: unknown, fallback: string): string => (typeof v === 'string' && v !== '' ? stripNul(v) : fallback);
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
const jsonObject = (v: unknown): Record<string, unknown> | null => (isObject(v) ? (stripNul(v) as Record<string, unknown>) : null);
const jsonArray = (v: unknown): unknown[] => (Array.isArray(v) ? stripNul(v) : []);
const hexId = (v: unknown, label: string, docId: string): string => {
  const raw = v == null ? '' : String(v).toLowerCase();
  if (!HEX.test(raw)) throw new BackfillError(`${label} is not a 24-char hex id`, docId);
  return raw;
};
const hexIdOrNull = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  const raw = String(v).toLowerCase();
  return HEX.test(raw) ? raw : null;
};

const stamps = (doc: MongoDoc) => ({ created_at: dNow(doc.createdAt), updated_at: dNow(doc.updatedAt) });
const idOf = (doc: MongoDoc): string => hexId(doc._id, '_id', String(doc._id));

const oneOf = (value: unknown, allowed: string[], label: string): string | null =>
  allowed.includes(String(value)) ? null : `${label} '${value}' is not one of ${allowed.join('|')}`;
const firstReason = (...reasons: Array<string | null>): string | null => reasons.find((r) => r !== null) ?? null;
const dangling = (set: ReadonlySet<string>, id: unknown, label: string, gone: string): string | null =>
  set.has(String(id)) ? null : `dangling ${label} ${id} (${gone}; FK would reject)`;

// ---------------------------------------------------------------- columns

export const FLOW_COLUMNS = [
  'id', 'owner_id', 'assistant_operation_id', 'generation_provenance', 'schema_version', 'definition_revision', 'name', 'description',
  'trigger_config', 'settings', 'hitl_policy', 'hitl_blockers', 'nodes', 'control_edges', 'data_bindings', 'design_settings', 'is_favorite',
  'reflection_enabled', 'advisor_scoring_mode', 'advisor_autopilot_enabled', 'advisor_autopilot_target_score', 'advisor_autopilot_max_turns',
  'created_at', 'updated_at',
];
export const FLOW_WORKSPACE_COLUMNS = ['flow_id', 'workspace_id', 'position'];
export const SHARE_COLUMNS = ['id', 'playbook_id', 'shared_by', 'shared_with', 'permission', 'created_at', 'updated_at'];

/** Columns written as jsonb: an array must be stringified, or the driver sends it as a Postgres array. */
const JSON_COLUMNS = new Set([
  'generation_provenance', 'trigger_config', 'settings', 'hitl_policy', 'hitl_blockers', 'nodes', 'control_edges', 'data_bindings', 'design_settings',
]);

export const DESCRIPTION_MAX = 80000;

// ---------------------------------------------------------------- flows

/**
 * A flow row. Missing fields take the defaults Mongoose filled in on every read (settings, HITL
 * policy, design settings); the node graph arrays are copied as they are.
 */
export const buildFlow = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  const row: Row = {
    id,
    owner_id: hexId(doc.ownerId, 'ownerId', id),
    assistant_operation_id: typeof doc.assistantOperationId === 'string' ? stripNul(doc.assistantOperationId) : null,
    generation_provenance: jsonObject(doc.generationProvenance),
    schema_version: int(doc.schemaVersion) ?? 1,
    definition_revision: int(doc.definitionRevision) ?? 0,
    name: typeof doc.name === 'string' ? stripNul(doc.name) : '',
    description: typeof doc.description === 'string' ? stripNul(doc.description) : null,
    trigger_config: jsonObject(doc.triggerConfig),
    settings: jsonObject(doc.settings) ?? { ...DEFAULT_FLOW_SETTINGS },
    hitl_policy: jsonObject(doc.hitlPolicy) ?? castHitlPolicy(undefined),
    hitl_blockers: jsonArray(doc.hitlBlockers),
    nodes: jsonArray(doc.nodes),
    control_edges: jsonArray(doc.controlEdges),
    data_bindings: jsonArray(doc.dataBindings),
    design_settings: doc.designSettings === undefined ? { ...DEFAULT_DESIGN_SETTINGS } : jsonObject(doc.designSettings),
    is_favorite: bool(doc.isFavorite, false),
    reflection_enabled: bool(doc.reflectionEnabled, false),
    advisor_scoring_mode: doc.advisorScoringMode == null ? 'llm' : String(doc.advisorScoringMode),
    advisor_autopilot_enabled: bool(doc.advisorAutopilotEnabled, false),
    advisor_autopilot_target_score: num(doc.advisorAutopilotTargetScore),
    advisor_autopilot_max_turns: int(doc.advisorAutopilotMaxTurns),
    ...stamps(doc),
  };
  const workspaces = [...new Set((Array.isArray(doc.workspaces) ? doc.workspaces : []).map((w) => String(w).trim().toLowerCase()))];
  Object.defineProperty(row, 'workspaces', { value: workspaces, enumerable: false });
  return row;
};

/** Every workspace id the Mongo flow carried, lower-cased and de-duplicated, in its order. */
export const flowWorkspaces = (row: Row): string[] => ((row as { workspaces?: string[] }).workspaces ?? []);

/** The workspace ids the foreign key accepts; the others are dropped from the junction, the flow is kept. */
export const liveWorkspaces = (row: Row, refs: PlaybookFlowRefs): string[] => flowWorkspaces(row).filter((w) => HEX.test(w) && refs.workspaces.has(w));

export const validateFlow = (row: Row, refs: PlaybookFlowRefs): string | null => {
  const name = String(row.name);
  const description = row.description === null ? '' : String(row.description);
  return firstReason(
    dangling(refs.users, row.owner_id, 'owner_id', 'user gone from PG'),
    name.length < 2 || name.length > 100 ? `name length ${name.length} is outside 2..100` : null,
    description.length > DESCRIPTION_MAX ? `description length ${description.length} exceeds ${DESCRIPTION_MAX}` : null,
    oneOf(row.advisor_scoring_mode, ['llm', 'heuristic'], 'advisor_scoring_mode'),
  );
};

// ---------------------------------------------------------------- shares

export const buildShare = (doc: MongoDoc): Row => {
  const id = idOf(doc);
  return {
    id,
    playbook_id: hexId(doc.playbookId ?? doc.flowId, 'playbookId', id),
    shared_by: hexId(doc.sharedBy, 'sharedBy', id),
    shared_with: hexId(doc.sharedWith, 'sharedWith', id),
    permission: sDefault(doc.permission, 'read'),
    ...stamps(doc),
  };
};

export const validateShare = (row: Row, refs: PlaybookFlowRefs): string | null =>
  firstReason(
    dangling(refs.flows, row.playbook_id, 'playbook_id', 'flow gone'),
    dangling(refs.users, row.shared_by, 'shared_by', 'user gone from PG'),
    dangling(refs.users, row.shared_with, 'shared_with', 'user gone from PG'),
    oneOf(row.permission, ['read', 'write'], 'permission'),
  );

// ---------------------------------------------------------------- insert

const values = (columns: string[], row: Row): unknown[] =>
  columns.map((c) => (JSON_COLUMNS.has(c) && row[c] !== null ? JSON.stringify(row[c]) : row[c]));

/**
 * INSERT ... ON CONFLICT (id) DO NOTHING. jsonb columns are stringified here so the unit keeps the
 * plain value the checksum compares. Other unique indexes are not swallowed: the violation is
 * recorded as a failure of that row.
 */
export async function insertRow(pool: Queryable, table: string, columns: string[], row: Row): Promise<void> {
  await pool.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (id) DO NOTHING`,
    values(columns, row),
  );
}

/**
 * A flow and its live workspaces in one statement: both or neither. A flow already in Postgres is
 * left as it is, workspaces included.
 */
export async function insertFlow(pool: Queryable, row: Row, refs: PlaybookFlowRefs): Promise<void> {
  const workspaces = liveWorkspaces(row, refs);
  const n = FLOW_COLUMNS.length;
  await pool.query(
    `WITH flow AS (
       INSERT INTO playbook.flows (${FLOW_COLUMNS.join(', ')}) VALUES (${FLOW_COLUMNS.map((_, i) => `$${i + 1}`).join(', ')})
       ON CONFLICT (id) DO NOTHING RETURNING id
     )
     INSERT INTO playbook.flow_workspaces (flow_id, workspace_id, position)
     SELECT flow.id, w.workspace_id, (w.ord - 1)::int FROM flow, unnest($${n + 1}::char(24)[]) WITH ORDINALITY AS w(workspace_id, ord)`,
    [...values(FLOW_COLUMNS, row), workspaces],
  );
}

/** SELECT list for the checksum read-back (no numeric or bigint column here). */
export const checksumSelect = (columns: string[]): string => columns.join(', ');

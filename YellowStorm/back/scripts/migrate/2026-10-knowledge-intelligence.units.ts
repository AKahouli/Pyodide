/**
 * Mongo → Postgres mapping of the six knowledge-intelligence collections (roadmap P6).
 * Separate from the runner so a spec can drive the same mapping and insert with fabricated
 * documents: the collections are empty in dev, so a real run would never exercise it.
 *
 * Unit rows use the Postgres column names as keys; `columns` is both the insert list and the
 * checksum read-back list, so the two cannot drift apart.
 */
import { stripNul } from '../../src/common/postgres/json';
import { BackfillError, type MongoDoc } from './harness';

export type Row = Record<string, unknown>;

export interface KnowledgeUnit {
  name: string;
  mongo: string;
  table: string;
  columns: string[];
  jsonColumns: string[];
  /** jsonb columns declared NOT NULL: a missing value is stored as JSON null, not SQL NULL. */
  notNullJsonColumns?: string[];
  build: (doc: MongoDoc) => Row;
}

const HEX = /^[0-9a-f]{24}$/;
const d = (v: unknown): Date | null => {
  if (v == null) return null;
  const date = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(date.getTime()) ? null : date;
};
const dNow = (v: unknown): Date => d(v) ?? new Date();
const s = (v: unknown): string | null => (v == null ? null : stripNul(String(v)));
const sReq = (v: unknown): string => stripNul(String(v ?? ''));
const n = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
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
const hexIds = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x).toLowerCase()).filter((x) => HEX.test(x)) : []);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => stripNul(String(x))) : []);
/** Strip BSON / undefined / U+0000 so jsonb accepts the value. */
const json = <T>(v: unknown, fallback: T): T => {
  try {
    return stripNul(JSON.parse(JSON.stringify(v ?? fallback)) as T);
  } catch {
    return fallback;
  }
};
const jsonOrNull = (v: unknown): unknown => (v == null ? null : json(v, null));

const common = (doc: MongoDoc) => {
  const id = hexId(doc._id, '_id', String(doc._id));
  return { id, program_id: hexId(doc.programId, 'programId', id), created_at: dNow(doc.createdAt), updated_at: dNow(doc.updatedAt) };
};

/** Dependency order: jobs before the temporal records that reference them. */
export const KNOWLEDGE_UNITS: KnowledgeUnit[] = [
  {
    name: 'jobs',
    mongo: 'knowledge_extraction_jobs',
    table: 'governance.knowledge_extraction_jobs',
    columns: ['id', 'program_id', 'document_id', 'connector_id', 'requested_by_user_id', 'job_type', 'status', 'input_hash', 'engine_version', 'attempts', 'error', 'started_at', 'completed_at', 'lease_expires_at', 'lease_token', 'next_attempt_at', 'created_at', 'updated_at'],
    jsonColumns: [],
    build: (doc) => {
      const c = common(doc);
      return {
        ...c,
        document_id: hexId(doc.documentId, 'documentId', c.id),
        connector_id: hexId(doc.connectorId, 'connectorId', c.id),
        requested_by_user_id: hexIdOrNull(doc.requestedByUserId),
        job_type: sReq(doc.jobType),
        status: sReq(doc.status ?? 'pending'),
        input_hash: sReq(doc.inputHash),
        engine_version: sReq(doc.engineVersion),
        attempts: Math.max(0, Math.trunc(n(doc.attempts, 0))),
        error: s(doc.error),
        started_at: d(doc.startedAt),
        completed_at: d(doc.completedAt),
        lease_expires_at: d(doc.leaseExpiresAt),
        lease_token: s(doc.leaseToken),
        next_attempt_at: d(doc.nextAttemptAt),
      };
    },
  },
  {
    name: 'temporal',
    mongo: 'temporal_candidate_records',
    table: 'governance.temporal_candidate_records',
    columns: ['id', 'program_id', 'document_id', 'job_id', 'candidate_id', 'candidate', 'validation', 'evidence', 'decision_status', 'decision_lease_expires_at', 'decision_token', 'decided_by', 'decided_at', 'decision_comment', 'corrected_candidate', 'input_hash', 'engine_version', 'created_at', 'updated_at'],
    jsonColumns: ['candidate', 'validation', 'evidence', 'corrected_candidate'],
    build: (doc) => {
      const c = common(doc);
      return {
        ...c,
        document_id: hexId(doc.documentId, 'documentId', c.id),
        job_id: hexId(doc.jobId, 'jobId', c.id),
        candidate_id: sReq(doc.candidateId),
        candidate: json(doc.candidate, {}),
        validation: json(doc.validation, {}),
        evidence: json(Array.isArray(doc.evidence) ? doc.evidence : [], []),
        decision_status: sReq(doc.decisionStatus ?? 'pending'),
        decision_lease_expires_at: d(doc.decisionLeaseExpiresAt),
        decision_token: s(doc.decisionToken),
        decided_by: hexIdOrNull(doc.decidedBy),
        decided_at: d(doc.decidedAt),
        decision_comment: s(doc.decisionComment),
        corrected_candidate: jsonOrNull(doc.correctedCandidate),
        input_hash: sReq(doc.inputHash),
        engine_version: sReq(doc.engineVersion),
      };
    },
  },
  {
    name: 'alerts',
    mongo: 'knowledge_alerts',
    table: 'governance.knowledge_alerts',
    columns: ['id', 'program_id', 'scope_ids', 'document_id', 'category', 'severity', 'status', 'title', 'description', 'deduplication_key', 'evidence_refs', 'opened_at', 'resolved_at', 'acknowledged_by', 'acknowledged_at', 'created_at', 'updated_at'],
    jsonColumns: [],
    build: (doc) => {
      const c = common(doc);
      return {
        ...c,
        scope_ids: hexIds(doc.scopeIds),
        document_id: hexIdOrNull(doc.documentId),
        category: sReq(doc.category),
        severity: sReq(doc.severity),
        status: sReq(doc.status ?? 'open'),
        title: sReq(doc.title),
        description: sReq(doc.description),
        deduplication_key: sReq(doc.deduplicationKey),
        evidence_refs: strings(doc.evidenceRefs),
        opened_at: dNow(doc.openedAt ?? doc.createdAt),
        resolved_at: d(doc.resolvedAt),
        acknowledged_by: hexIdOrNull(doc.acknowledgedBy),
        acknowledged_at: d(doc.acknowledgedAt),
      };
    },
  },
  {
    name: 'assessments',
    mongo: 'knowledge_assessments',
    table: 'governance.knowledge_assessments',
    columns: ['id', 'program_id', 'scope_ids', 'document_id', 'assessment_version', 'input_hash', 'assessed_at', 'dimensions', 'overall_health_score', 'status', 'summary', 'created_at', 'updated_at'],
    jsonColumns: ['dimensions'],
    build: (doc) => {
      const c = common(doc);
      return {
        ...c,
        scope_ids: hexIds(doc.scopeIds),
        document_id: hexId(doc.documentId, 'documentId', c.id),
        assessment_version: sReq(doc.assessmentVersion),
        input_hash: sReq(doc.inputHash),
        assessed_at: dNow(doc.assessedAt),
        dimensions: json(doc.dimensions, {}),
        overall_health_score: n(doc.overallHealthScore, 0),
        status: sReq(doc.status),
        summary: sReq(doc.summary),
      };
    },
  },
  {
    name: 'recommendations',
    mongo: 'knowledge_recommendations',
    table: 'governance.knowledge_recommendations',
    columns: ['id', 'program_id', 'scope_ids', 'document_id', 'alert_ids', 'type', 'priority', 'reason', 'impact_summary', 'proposed_action', 'status', 'deduplication_key', 'decided_by', 'decided_at', 'decision_reason', 'applied_by', 'applied_at', 'application_token', 'application_lease_expires_at', 'created_at', 'updated_at'],
    jsonColumns: ['proposed_action'],
    build: (doc) => {
      const c = common(doc);
      return {
        ...c,
        scope_ids: hexIds(doc.scopeIds),
        document_id: hexIdOrNull(doc.documentId),
        alert_ids: hexIds(doc.alertIds),
        type: sReq(doc.type),
        priority: sReq(doc.priority),
        reason: sReq(doc.reason),
        impact_summary: sReq(doc.impactSummary),
        proposed_action: jsonOrNull(doc.proposedAction),
        status: sReq(doc.status ?? 'proposed'),
        deduplication_key: sReq(doc.deduplicationKey),
        decided_by: hexIdOrNull(doc.decidedBy),
        decided_at: d(doc.decidedAt),
        decision_reason: s(doc.decisionReason),
        applied_by: hexIdOrNull(doc.appliedBy),
        applied_at: d(doc.appliedAt),
        application_token: s(doc.applicationToken),
        application_lease_expires_at: d(doc.applicationLeaseExpiresAt),
      };
    },
  },
  {
    name: 'metadata',
    mongo: 'metadata_candidates',
    table: 'governance.metadata_candidates',
    columns: ['id', 'program_id', 'scope_ids', 'document_id', 'key', 'proposed_value', 'candidate_type', 'confidence', 'risk_level', 'evidence_refs', 'status', 'candidate_key', 'accepted_value', 'decided_by', 'decided_at', 'decision_reason', 'created_at', 'updated_at'],
    jsonColumns: ['proposed_value', 'accepted_value'],
    notNullJsonColumns: ['proposed_value'],
    build: (doc) => {
      const c = common(doc);
      return {
        ...c,
        scope_ids: hexIds(doc.scopeIds),
        document_id: hexId(doc.documentId, 'documentId', c.id),
        key: sReq(doc.key),
        // jsonb holds any JSON value, a bare string or number included; a missing value is JSON null.
        proposed_value: json(doc.proposedValue ?? null, null),
        candidate_type: sReq(doc.candidateType),
        confidence: n(doc.confidence, 0),
        risk_level: sReq(doc.riskLevel),
        evidence_refs: strings(doc.evidenceRefs),
        status: sReq(doc.status ?? 'proposed'),
        candidate_key: sReq(doc.candidateKey),
        accepted_value: jsonOrNull(doc.acceptedValue),
        decided_by: hexIdOrNull(doc.decidedBy),
        decided_at: d(doc.decidedAt),
        decision_reason: s(doc.decisionReason),
      };
    },
  },
];

/**
 * Inserts one unit row. A JSON column is serialised explicitly: node-postgres would
 * otherwise turn an array value into a Postgres array literal instead of jsonb. A null in a
 * nullable JSON column stays SQL NULL; in a NOT NULL one it becomes the JSON value null.
 */
export async function insertKnowledgeRow(
  pool: { query: (sql: string, values: unknown[]) => Promise<unknown> },
  unit: KnowledgeUnit,
  row: Row,
): Promise<void> {
  const values = unit.columns.map((c) => {
    if (!unit.jsonColumns.includes(c)) return row[c];
    if (row[c] === null && !unit.notNullJsonColumns?.includes(c)) return null;
    return JSON.stringify(row[c]);
  });
  await pool.query(
    `INSERT INTO ${unit.table} (${unit.columns.join(', ')}) VALUES (${unit.columns.map((_, i) => `$${i + 1}`).join(', ')}) ON CONFLICT (id) DO NOTHING`,
    values,
  );
}

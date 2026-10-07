import type { GovernanceScopeAudience, GovernanceScopeKnowledge, GovernanceScopeRecord } from './governance-records';


export interface GovernanceScopeCreateInput {
  programId: string;
  name: string;
  type?: GovernanceScopeRecord['type'];
  status?: GovernanceScopeRecord['status'];
  parentScopeId?: string;
  agentIds?: string[];
  audience?: GovernanceScopeAudience;
  knowledge?: GovernanceScopeKnowledge;
  metadata?: Record<string, unknown>;
}

export interface GovernanceScopePatch {
  name?: string;
  /** `undefined` = no change; `null` clears the parent (Mongo `$unset`-equivalent). */
  parentScopeId?: string | null;
  type?: GovernanceScopeRecord['type'];
  status?: GovernanceScopeRecord['status'];
  agentIds?: string[];
  audience?: GovernanceScopeAudience;
  knowledge?: GovernanceScopeKnowledge;
  metadata?: Record<string, unknown>;
}

/** Internal write/read store for the governance_scopes aggregate (+ agent/audience child rows). */
export interface ScopeStore {
  insert(input: GovernanceScopeCreateInput): Promise<GovernanceScopeRecord>;
  findById(scopeId: string): Promise<GovernanceScopeRecord | null>;
  findByProgramAndId(programId: string, scopeId: string): Promise<GovernanceScopeRecord | null>;
  /** Scopes of the program; `scopeIds: '*'` selects all, otherwise only the given ids. Ordered by createdAt asc. */
  listByProgram(programId: string, scopeIds: string[] | '*'): Promise<GovernanceScopeRecord[]>;
  /** All active scopes across programs (consumer catalogue). */
  listActive(): Promise<GovernanceScopeRecord[]>;
  /** Direct child scope ids of `parentScopeId` within the program. */
  update(scopeId: string, patch: GovernanceScopePatch): Promise<GovernanceScopeRecord | null>;
  /** Draft preparation stamps `metadata.review.status` via a jsonb path set. */
  setMetadataReviewStatus(scopeId: string, status: string): Promise<void>;
  countByProgram(programId: string): Promise<number>;
  deleteByIdAndProgram(scopeId: string, programId: string): Promise<void>;
  /** Deletes the given scopes; callers pass the whole subtree so parent FKs stay satisfied. */
  deleteByIdsAndProgram(scopeIds: string[], programId: string): Promise<void>;
  /** Every (id, parentScopeId) pair of a program, for in-memory subtree walks. */
  listHierarchy(programId: string): Promise<{ id: string; parentScopeId: string | null }[]>;
}

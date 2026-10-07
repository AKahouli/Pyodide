import type { GovernanceBindingRecord } from './governance-records';


export interface GovernanceBindingCreateInput {
  programId: string;
  workspaceId: string;
  visibility: GovernanceBindingRecord['visibility'];
  scopeIds: string[];
  ingestionMode?: GovernanceBindingRecord['ingestionMode'];
  defaults?: Record<string, unknown>;
  createdBy: string;
}

export interface GovernanceBindingPatch {
  enabled?: boolean;
  ingestionMode?: GovernanceBindingRecord['ingestionMode'];
  defaults?: Record<string, unknown>;
}

/**
 * Internal write/read store for governance_workspace_bindings (+ the
 * governance_binding_scopes child rows that carry `scopeIds`).
 */
export interface BindingStore {
  insert(input: GovernanceBindingCreateInput): Promise<GovernanceBindingRecord>;
  findByProgramAndWorkspace(programId: string, workspaceId: string): Promise<GovernanceBindingRecord | null>;
  findById(bindingId: string): Promise<GovernanceBindingRecord | null>;
  findByIdAndProgram(programId: string, bindingId: string): Promise<GovernanceBindingRecord | null>;
  existsByIdAndProgram(programId: string, bindingId: string): Promise<boolean>;
  listByProgram(programId: string): Promise<GovernanceBindingRecord[]>;
  listEnabledForWorkspace(workspaceId: string): Promise<GovernanceBindingRecord[]>;
  /** Enabled bindings of the program; `'*'` = all, otherwise program-shared or scoped to one of `scopeIds`. */
  listEnabled(programId: string, scopeIds: string[] | '*'): Promise<GovernanceBindingRecord[]>;
  update(bindingId: string, patch: GovernanceBindingPatch): Promise<GovernanceBindingRecord | null>;
  /** Rewrites visibility and the scope-id child rows together (connect-existing-binding path). */
  replaceScopeIds(bindingId: string, scopeIds: string[], visibility: GovernanceBindingRecord['visibility']): Promise<GovernanceBindingRecord | null>;
  deleteById(bindingId: string): Promise<void>;
  /** Workspace ids from `workspaceIds` bound (enabled) to the scope or program-shared. */
  filterWorkspaceIdsBoundToScope(programId: string, workspaceIds: string[], scopeId: string): Promise<string[]>;
  countByProgram(programId: string): Promise<number>;
  /**
   * Scope-tree cleanup: deletes scope_specific bindings containing `scopeId`
   * and multi_scope bindings whose only scope is `scopeId`; removes `scopeId`
   * from remaining multi_scope bindings, downgrading single-scope leftovers to
   * scope_specific.
   */
  removeScopesFromProgramBindings(programId: string, scopeIds: string[]): Promise<void>;
}

export interface GovernanceGroupSummary {
  id: string;
  name: string;
  memberCount: number;
}

export const GROUP_LOOKUP_PORT = Symbol('GOVERNANCE_GROUP_LOOKUP_PORT');

/**
 * Read-only group summaries for membership responses — the replacement for the
 * former `.populate('groupId', 'name members')`. Groups stay Mongo-backed
 * (out of migration scope); the adapter lives with the group model.
 */
export interface GovernanceGroupLookupPort {
  summariesByIds(ids: string[]): Promise<Map<string, GovernanceGroupSummary>>;
}

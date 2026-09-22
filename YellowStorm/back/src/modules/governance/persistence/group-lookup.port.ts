export interface GovernanceGroupSummary {
  id: string;
  name: string;
  memberCount: number;
}

export const GROUP_LOOKUP_PORT = Symbol('GOVERNANCE_GROUP_LOOKUP_PORT');

/**
 * Read-only group summaries for membership responses — the replacement for the
 * former Mongo populate of groupId ('name members'). Backed by identity.user_groups
 * in Postgres (remediation plan step 1).
 */
export interface GovernanceGroupLookupPort {
  summariesByIds(ids: string[]): Promise<Map<string, GovernanceGroupSummary>>;
}

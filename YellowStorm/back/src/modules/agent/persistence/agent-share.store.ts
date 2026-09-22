/** Store port for public.shared_agents (plan 4.1). */
export const AGENT_SHARE_STORE = Symbol('AGENT_SHARE_STORE');

export interface AgentShareRow {
  id: string;
  agentId: string;
  sharedBy: string;
  sharedWith: string;
  permission: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentShareStore {
  /**
   * Batch share upsert (plan 4.1): one INSERT … ON CONFLICT
   * (agent_id, shared_with) DO UPDATE for the whole batch.
   */
  upsertMany(agentId: string, sharedBy: string, sharedWithIds: string[], permission: string): Promise<AgentShareRow[]>;
  findByAgent(agentId: string): Promise<AgentShareRow[]>;
  find(agentId: string, sharedWith: string): Promise<AgentShareRow | null>;
  findByIdAndAgent(shareId: string, agentId: string): Promise<AgentShareRow | null>;
  /** Guard read: the share row for (agentId, userId), null when none. */
  findById(shareId: string): Promise<AgentShareRow | null>;
  updatePermission(shareId: string, agentId: string, permission: string): Promise<AgentShareRow | null>;
  deleteByIdAndAgent(shareId: string, agentId: string): Promise<AgentShareRow | null>;
  deleteForUser(agentId: string, userId: string): Promise<AgentShareRow | null>;
  listSharedWithUser(userId: string): Promise<AgentShareRow[]>;
}

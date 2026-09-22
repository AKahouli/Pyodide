/** Store port for catalog.agent_types, agent_type_skills and agent_type_prompts (plan 1B.4.3). */
export const AGENT_TYPE_STORE = Symbol('AGENT_TYPE_STORE');

export interface AgentTypeRow {
  id: string;
  name: string;
  slug: string;
  defaultPrompt: string;
  /** Skill ids ordered by junction position (plan 1B.4.3). */
  skills: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewAgentTypeRow {
  name: string;
  slug: string;
  defaultPrompt: string;
  skills: string[];
  isActive: boolean;
}

export interface AgentTypeListQuery {
  search?: string;
  isActive?: boolean;
  page: number;
  limit: number;
}

export interface AgentTypePromptRow {
  id: string;
  agentTypeId: string;
  modelId: string;
  prompt: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentTypeStore {
  findById(id: string): Promise<AgentTypeRow | null>;
  findByIds(ids: string[]): Promise<AgentTypeRow[]>;
  findBySlug(slug: string, activeOnly?: boolean): Promise<AgentTypeRow | null>;
  findByNameOrSlug(name: string, slug: string): Promise<AgentTypeRow | null>;
  findByNameOrSlugExcluding(excludeId: string, name: string, slug: string): Promise<AgentTypeRow | null>;
  insert(row: NewAgentTypeRow): Promise<AgentTypeRow>;
  update(id: string, patch: Partial<Omit<NewAgentTypeRow, 'skills'>> & { skills?: string[] }): Promise<AgentTypeRow | null>;
  delete(id: string): Promise<AgentTypeRow | null>;
  list(query: AgentTypeListQuery): Promise<{ rows: AgentTypeRow[]; total: number }>;
  findAllActive(): Promise<AgentTypeRow[]>;
  /** INSERT … ON CONFLICT (slug) DO NOTHING, then SELECT. */
  findOrCreateBySlug(slug: string, data: { name: string; defaultPrompt: string; isActive: boolean }): Promise<AgentTypeRow>;
  promptCount(agentTypeId: string): Promise<number>;
  promptCountsFor(agentTypeIds: string[]): Promise<Map<string, number>>;
  promptsFor(agentTypeId: string): Promise<AgentTypePromptRow[]>;
  upsertPrompt(agentTypeId: string, modelId: string, prompt: string): Promise<AgentTypePromptRow>;
  deletePrompt(agentTypeId: string, modelId: string): Promise<AgentTypePromptRow | null>;
  findPrompt(agentTypeId: string, modelId: string): Promise<AgentTypePromptRow | null>;
  findPromptsForPairs(pairs: { agentTypeId: string; modelId: string }[]): Promise<AgentTypePromptRow[]>;
}

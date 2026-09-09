import type { agents } from '../../postgres/schema';

export type AgentRow = typeof agents.$inferSelect;

export interface AgentJunctions {
  tools: string[];
  skills: string[];
  disabledSkills: string[];
  connectors: string[];
  knowledgeBases: string[];
  connectorActions: Array<{ connectorId: string; actionKeys: string[] }>;
}

export interface AgentRecord {
  _id: string;
  name: string;
  slug: string;
  agentType: string;
  agentTypeSlug: string;
  role: string;
  description: string;
  temperature: number;
  llmModel?: string;
  reasoningEffort?: string;
  email?: string;
  instruction: string;
  ignorePrePrompt: boolean;
  knowledgeBases: string[];
  tools: string[];
  skills: string[];
  disabledSkills: string[];
  connectors: string[];
  connectorActionSelections: Array<{ connector: string; actionKeys: string[] }>;
  guardrails: Record<string, unknown>;
  deploymentSettings: Record<string, unknown>;
  enable_temporary_child_agents: boolean;
  max_temporary_child_agents: number;
  isDefault: boolean;
  isActive: boolean;
  isDefaultForType: boolean;
  createdBy: string;
  a2aPublished: boolean;
  a2aAgentId?: string;
  a2aAgentCardUrl?: string;
  a2aApiKeyHeader?: string;
  a2aPublishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Postgres `char(n)` right-pads with spaces; trim so ids compare equal to Mongo hex. */
export function trim24(v: string): string {
  return typeof v === 'string' ? v.trim() : v;
}

export function rowToRecord(row: AgentRow, j: AgentJunctions): AgentRecord {
  return {
    _id: trim24(row.id),
    name: row.name,
    slug: row.slug,
    agentType: trim24(row.agentTypeId),
    agentTypeSlug: row.agentTypeSlug,
    role: row.role,
    description: row.description,
    temperature: row.temperature,
    llmModel: row.llmModel ?? undefined,
    reasoningEffort: row.reasoningEffort ?? undefined,
    email: row.email ?? undefined,
    instruction: row.instruction,
    ignorePrePrompt: row.ignorePrePrompt,
    knowledgeBases: j.knowledgeBases.map(trim24),
    tools: j.tools.map(trim24),
    skills: j.skills.map(trim24),
    disabledSkills: j.disabledSkills.map(trim24),
    connectors: j.connectors.map(trim24),
    connectorActionSelections: j.connectorActions.map((a) => ({
      connector: trim24(a.connectorId),
      actionKeys: a.actionKeys,
    })),
    guardrails: (row.guardrails as Record<string, unknown>) ?? {},
    deploymentSettings: (row.deploymentSettings as Record<string, unknown>) ?? {},
    enable_temporary_child_agents: row.enableTemporaryChildAgents,
    max_temporary_child_agents: row.maxTemporaryChildAgents,
    isDefault: row.isDefault,
    isActive: row.isActive,
    isDefaultForType: row.isDefaultForType,
    createdBy: trim24(row.createdBy),
    a2aPublished: row.a2aPublished,
    a2aAgentId: row.a2aAgentId ?? undefined,
    a2aAgentCardUrl: row.a2aAgentCardUrl ?? undefined,
    a2aApiKeyHeader: row.a2aApiKeyHeader ?? undefined,
    a2aPublishedAt: row.a2aPublishedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

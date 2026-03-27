/**
 * Agent Module Types
 */

export interface Agent {
  id: string;
  name: string;
  agentType: { id: string; name: string };
  role: string;
  description: string;
  temperature: number;
  model?: string;
  instruction: string;
  ignorePrePrompt: boolean;
  knowledgeBases: string[];
  tools: string[];
  isDefault: boolean;
  isDefaultForType: boolean;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentType {
  id: string;
  name: string;
  slug: string;
  prePrompt: string;
  isActive: boolean;
}

export interface AgentState {
  agents: Agent[];
  agentTypes: AgentType[];
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  lastFetchedAt: Date | null;
}

export interface AgentActions {
  fetchAgents: () => Promise<void>;
  fetchAgentTypes: () => Promise<void>;
  createAgent: (data: CreateAgentData) => Promise<Agent>;
  updateAgent: (id: string, data: UpdateAgentData) => Promise<Agent>;
  deleteAgent: (id: string) => Promise<void>;
  getPersonalAgents: () => Agent[];
  getDefaultAgents: () => Agent[];
  getAgentById: (id: string) => Agent | undefined;
  refreshAgents: () => Promise<void>;
  reset: () => void;
}

export type AgentStore = AgentState & AgentActions;

export interface CreateAgentData {
  name: string;
  agentType: string;
  role: string;
  description?: string;
  temperature?: number;
  model?: string;
  instruction?: string;
  ignorePrePrompt?: boolean;
  knowledgeBases?: string[];
  tools?: string[];
  isActive?: boolean;
  isDefaultForType?: boolean;
}

export interface UpdateAgentData {
  name?: string;
  agentType?: string;
  role?: string;
  description?: string;
  temperature?: number;
  model?: string;
  instruction?: string;
  ignorePrePrompt?: boolean;
  knowledgeBases?: string[];
  tools?: string[];
  isActive?: boolean;
  isDefaultForType?: boolean;
}

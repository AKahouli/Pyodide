export interface IAgentResponse {
  id: string;
  name: string;
  slug: string;
  agentType: { id: string; name: string };
  role: string;
  description: string;
  temperature: number;
  model?: string;
  instruction: string;
  ignorePrePrompt: boolean;
  knowledgeBases: string[];
  tools: string[];
  connectors?: string[];
  skills?: string[];
  disabledSkills?: string[];
  isDefault: boolean;
  isDefaultForType: boolean;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAgentForStream {
  id: string;
  name: string;
  agentTypeName: string;
  agentTypeSlug: string;
  agentTypeId: string;
  role: string;
  description: string;
  temperature: number;
  model?: string;
  instruction: string;
  ignorePrePrompt: boolean;
  knowledgeBases: string[];
  toolIds: string[];
  connectorIds?: string[];
  skillIds?: string[];
  disabledSkillIds?: string[];
  agentTypeSkillIds?: string[];
  isDefault: boolean;
  isDefaultForType: boolean;
}

export interface IGrpcWorkspaceContext {
  workspace_id: string;
  workspace_name?: string;
  chunks?: number;
  hybrid_search?: boolean;
  instruction?: string;
  tag?: string;
  workspace_documents: Array<{
    _id: string;
    filename: string;
    filepath: string;
    in_memory: boolean;
    language: string;
    indexing_token: number;
    workspace_id: string;
    workspace_name?: string;
    file_name?: string;
    createdAt: string;
  }>;
}

export interface IGrpcAgent {
  id: string;
  name: string;
  description: string;
  prompt: string;
  agent_type: string;
  save_memory: boolean;
  tools: Record<string, unknown>[];
  skills?: Array<Record<string, unknown>>;
  brain_context: IGrpcWorkspaceContext[];
  chatbot: {
    model: string;
  };
  agent_params?: {
    params: Record<string, string>;
  };
  connector_bindings?: Record<string, unknown>[];
  connectorIds?: string[];
}

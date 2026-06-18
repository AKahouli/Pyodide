export interface IAgentConnectorActionSelectionResponse {
  connectorId: string;
  actionKeys: string[];
}

export type AgentPermissionLevel = 'read' | 'write';

/** A single share entry on an agent (owner's view of who it's shared with). */
export interface IAgentShareEntry {
  shareId: string;
  permission: AgentPermissionLevel;
  user: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
  };
  createdAt: Date;
}

/** Info about an agent shared with the current user (populated for non-owners). */
export interface ISharedAgentInfo {
  shareId: string;
  permission: AgentPermissionLevel;
  sharedBy: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
  };
}

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
  connectorActionSelections?: IAgentConnectorActionSelectionResponse[];
  skills?: string[];
  disabledSkills?: string[];
  isDefault: boolean;
  isDefaultForType: boolean;
  isActive: boolean;
  // A2A publishing state (non-secret). The API key is never returned here; it is
  // only surfaced once by the dedicated publish/rotate endpoints.
  a2aPublished: boolean;
  a2aAgentCardUrl?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  // Present when the agent was shared with the current user (non-owner).
  shareInfo?: ISharedAgentInfo;
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
  connectorActionSelections?: IAgentConnectorActionSelectionResponse[];
  connectorSkillIds?: string[];
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

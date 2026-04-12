export interface IConnectorActionResponse {
  key: string;
  label: string;
  description: string;
  parameterSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  safety: string;
  supportsBatch: boolean;
  supportsIteration: boolean;
  isEnabled: boolean;
}

export interface IConnectorResponse {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  authType: string;
  authConfigSchema: Record<string, unknown>;
  mcpTransportType: string;
  mcpServerUrl: string;
  mcpServerConfig: Record<string, unknown>;
  actions: IConnectorActionResponse[];
  referencedSkillIds: string[];
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IConnectorCredentialResponse {
  id: string;
  connectorId: string;
  displayName: string;
  status: string;
  lastValidatedAt: Date | null;
  expiresAt: Date | null;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IMcpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface IMcpInspectResult {
  serverName: string;
  tools: IMcpToolDefinition[];
  error?: string;
}

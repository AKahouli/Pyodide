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

export interface IConnectorDynamicHeader {
  headerName: string;
  source: string;
  enabled: boolean;
}

/** One action of a connector, in the gRPC `ConnectorAction` wire shape (snake_case). */
export interface IGrpcConnectorAction {
  action_key: string;
  label: string;
  description: string;
  /** JSON Schema of the action params, serialized as a string (proto carries it as a string). */
  parameter_schema_json: string;
}

/** A connector binding in the gRPC `ConnectorBinding` wire shape, with per-user auth resolved. */
export interface IGrpcConnector {
  connector_id: string;
  connector_name: string;
  mcp_transport_type: string;
  mcp_server_url: string;
  auth_headers: Record<string, string>;
  auth_env: Record<string, string>;
  actions: IGrpcConnectorAction[];
}

export interface IConnectorResponse {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  iconColor: 'light' | 'dark';
  categoryId: string | null;
  /** Resolved category name (populated by findAllActive); used by clients to exclude "System" connectors. */
  categoryName?: string | null;
  authType: string;
  authConfigSchema: Record<string, unknown>;
  authSourceType: string;
  connectedAppKey: string;
  runtimeAuthConfig: Record<string, unknown>;
  mcpTransportType: string;
  mcpServerUrl: string;
  mcpServerConfig: Record<string, unknown>;
  dynamicHeaders: IConnectorDynamicHeader[];
  actions: IConnectorActionResponse[];
  referencedSkillIds: string[];
  isActive: boolean;
  isSystem?: boolean;
  isHidden?: boolean;
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

export interface IConnectorCategoryResponse {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  createdBy: string;
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

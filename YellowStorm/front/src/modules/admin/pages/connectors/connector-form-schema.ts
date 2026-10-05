import type { ConnectorActionResponse, ConnectorDynamicHeaderSource } from '../../types';

export interface DynamicHeaderRow {
  id: string;
  headerName: string;
  source: ConnectorDynamicHeaderSource;
  enabled: boolean;
}

export interface ConnectorFormValues {
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  iconColor: 'light' | 'dark';
  categoryId: string;
  authType: string;
  authSourceType: string;
  connectedAppKey: string;
  runtimeAuthConfig: string;
  runtimeAuthStrategy: string;
  runtimeHeaderName: string;
  runtimeHeaderPrefix: string;
  runtimeHeaderMappings: Array<{ id: string; key: string; value: string }>;
  runtimeEnvMappings: Array<{ id: string; key: string; value: string }>;
  mcpTransportType: string;
  mcpServerUrl: string;
  githubPatToken: string;
  mcpServerConfig: string;
  dynamicHeaders: DynamicHeaderRow[];
  actions?: ConnectorActionResponse[];
  actionsJson: string;
  referencedSkillIds: string[];
  isActive: boolean;
  isHidden: boolean;
  isSystem: boolean;
}

export const defaultConnectorFormValues: ConnectorFormValues = {
  slug: '',
  name: '',
  description: '',
  icon: '',
  color: '',
  iconColor: 'light',
  categoryId: '',
  authType: 'none',
  authSourceType: 'none',
  connectedAppKey: '',
  runtimeAuthConfig: '',
  runtimeAuthStrategy: 'http_header_bearer',
  runtimeHeaderName: 'Authorization',
  runtimeHeaderPrefix: 'Bearer ',
  runtimeHeaderMappings: [],
  runtimeEnvMappings: [],
  mcpTransportType: 'streamable_http',
  mcpServerUrl: '',
  githubPatToken: '',
  mcpServerConfig: '',
  dynamicHeaders: [],
  actions: [],
  actionsJson: '',
  referencedSkillIds: [],
  isActive: true,
  isHidden: false,
  isSystem: false,
};

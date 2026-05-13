import type { ConnectorActionResponse } from '../../types';

export interface ConnectorFormValues {
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
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
  mcpServerConfig: string;
  actions?: ConnectorActionResponse[];
  actionsJson: string;
  referencedSkillIds: string[];
  isActive: boolean;
}

export const defaultConnectorFormValues: ConnectorFormValues = {
  slug: '',
  name: '',
  description: '',
  icon: '',
  color: '',
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
  mcpServerConfig: '',
  actions: [],
  actionsJson: '',
  referencedSkillIds: [],
  isActive: true,
};

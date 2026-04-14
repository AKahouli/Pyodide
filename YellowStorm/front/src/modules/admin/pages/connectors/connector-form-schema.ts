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
  mcpTransportType: string;
  mcpServerUrl: string;
  mcpServerConfig: string;
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
  authSourceType: 'credential',
  connectedAppKey: '',
  runtimeAuthConfig: '',
  mcpTransportType: 'streamable_http',
  mcpServerUrl: '',
  mcpServerConfig: '',
  actionsJson: '',
  referencedSkillIds: [],
  isActive: true,
};

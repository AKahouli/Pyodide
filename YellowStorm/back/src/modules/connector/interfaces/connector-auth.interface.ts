export interface ConnectorAuthService {
  resolveRuntimeAuth(
    userId: string,
    connector: {
      authSourceType: string;
      connectedAppKey: string;
      runtimeAuthConfig: Record<string, unknown>;
      connectorId?: string;
      credentialId?: string;
    },
  ): Promise<{ headers: Record<string, string>; env: Record<string, string> }>;
}

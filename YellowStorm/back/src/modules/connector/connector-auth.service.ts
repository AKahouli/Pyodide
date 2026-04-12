import { Injectable } from '@nestjs/common';
import { LoggerService } from '../logger';
import { ConnectedAppTokenService } from '../connected-app/services/connected-app-token.service';
import { ConnectorCredentialService } from './connector-credential.service';
import { ConnectorAuthService } from './interfaces/connector-auth.interface';

@Injectable()
export class ConnectorAuthServiceImpl implements ConnectorAuthService {
  constructor(
    private readonly connectedAppTokenService: ConnectedAppTokenService,
    private readonly credentialService: ConnectorCredentialService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ConnectorAuthServiceImpl.name);
  }

  async resolveRuntimeAuth(
    userId: string,
    connector: {
      authSourceType: string;
      connectedAppKey: string;
      runtimeAuthConfig: Record<string, unknown>;
    },
  ): Promise<{ headers: Record<string, string>; env: Record<string, string> }> {
    const empty = { headers: {}, env: {} };

    if (!connector.authSourceType || connector.authSourceType === 'none') {
      return empty;
    }

    const config = connector.runtimeAuthConfig || {};
    const strategy = (config.strategy as string) || 'http_header_bearer';

    if (connector.authSourceType === 'connected_app') {
      const appKey = connector.connectedAppKey;
      if (!appKey) {
        this.logger.warn('Connector has authSourceType=connected_app but no connectedAppKey');
        return empty;
      }

      try {
        const token = await this.connectedAppTokenService.getValidToken(userId, appKey);
        return this.buildAuthMaterial(strategy, token, config);
      } catch (error) {
        this.logger.warn('Failed to resolve connected-app token', {
          appKey,
          userId,
          error: (error as Error).message,
        });
        return empty;
      }
    }

    if (connector.authSourceType === 'credential') {
      return empty;
    }

    return empty;
  }

  private buildAuthMaterial(
    strategy: string,
    token: string,
    config: Record<string, unknown>,
  ): { headers: Record<string, string>; env: Record<string, string> } {
    if (strategy === 'http_header_bearer') {
      const headerName = (config.headerName as string) || 'Authorization';
      const headerPrefix = (config.headerPrefix as string) || 'Bearer ';
      return {
        headers: { [headerName]: `${headerPrefix}${token}` },
        env: {},
      };
    }

    if (strategy === 'custom_headers') {
      const headerMappings = (config.headerMappings as Record<string, string>) || {};
      const headers: Record<string, string> = {};
      for (const [header, template] of Object.entries(headerMappings)) {
        headers[header] = template.replace('{token}', token);
      }
      return { headers, env: {} };
    }

    if (strategy === 'env_vars') {
      const envMap = (config.envMap as Record<string, string>) || {};
      const env: Record<string, string> = {};
      for (const [varName, template] of Object.entries(envMap)) {
        env[varName] = template.replace('{token}', token);
      }
      return { headers: {}, env };
    }

    this.logger.warn('Unknown runtime auth strategy, defaulting to http_header_bearer', { strategy });
    return {
      headers: { Authorization: `Bearer ${token}` },
      env: {},
    };
  }
}

import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger';
import { ConnectedAppTokenService } from '../connected-app/services/connected-app-token.service';
import { UserService } from '../user/user.service';
import { ConnectorCredentialService } from './connector-credential.service';
import { ConnectorAuthService, ConnectorDynamicHeaderConfig } from './interfaces/connector-auth.interface';
import { DynamicHeaderSource } from './connector.types';

@Injectable()
export class ConnectorAuthServiceImpl implements ConnectorAuthService {
  constructor(
    private readonly connectedAppTokenService: ConnectedAppTokenService,
    private readonly credentialService: ConnectorCredentialService,
    private readonly userService: UserService,
    private readonly logger: LoggerService,
    @Optional() private readonly configService?: ConfigService,
  ) {
    this.logger.setContext(ConnectorAuthServiceImpl.name);
  }

  async resolveDynamicHeaders(
    userId: string,
    dynamicHeaders: ConnectorDynamicHeaderConfig[],
  ): Promise<Record<string, string>> {
    const enabled = (dynamicHeaders || []).filter(
      (h) => h?.headerName && h?.enabled !== false && h.source !== DynamicHeaderSource.WORKSPACE,
    );
    if (enabled.length === 0 || !userId) {
      return {};
    }

    let user: { _id: { toString(): string }; email?: string; profile?: { firstName?: string; lastName?: string } } | null = null;
    try {
      user = (await this.userService.findById(userId)) as any;
    } catch (error) {
      this.logger.warn('Failed to load user for dynamic header resolution', {
        userId,
        error: (error as Error).message,
      });
    }

    if (!user) {
      return {};
    }

    const firstName = user.profile?.firstName || '';
    const lastName = user.profile?.lastName || '';
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

    const headers: Record<string, string> = {};
    for (const row of enabled) {
      const value = this.resolveSourceValue(row.source, {
        userId: user._id.toString(),
        email: user.email || '',
        firstName,
        lastName,
        fullName,
      });
      if (value) {
        headers[row.headerName] = value;
      }
    }
    return headers;
  }

  private resolveSourceValue(
    source: string,
    ctx: { userId: string; email: string; firstName: string; lastName: string; fullName: string },
  ): string {
    switch (source) {
      case DynamicHeaderSource.USER_ID:
        return ctx.userId;
      case DynamicHeaderSource.USER_EMAIL:
        return ctx.email;
      case DynamicHeaderSource.USER_FIRST_NAME:
        return ctx.firstName;
      case DynamicHeaderSource.USER_LAST_NAME:
        return ctx.lastName;
      case DynamicHeaderSource.USER_FULL_NAME:
        return ctx.fullName;
      default:
        return '';
    }
  }

  async resolveRuntimeAuth(
    userId: string,
    connector: {
      authSourceType: string;
      connectedAppKey: string;
      runtimeAuthConfig: Record<string, unknown>;
      connectorId?: string;
      credentialId?: string;
    },
  ): Promise<{ headers: Record<string, string>; env: Record<string, string> }> {
    const empty = { headers: {}, env: {} };

    if (!connector.authSourceType || connector.authSourceType === 'none') {
      return empty;
    }

    const config = connector.runtimeAuthConfig || {};
    const strategy = (config.strategy as string) || 'http_header_bearer';

    if (connector.authSourceType === 'server_config') {
      if (config.secretKey === 'playbook_mcp_ingress') {
        const token = this.configService?.get<string>('playbook-flow.mcpIngressToken', '') ?? '';
        if (!token) {
          this.logger.warn('Playbook MCP ingress token is not configured');
          return empty;
        }
        return { headers: { Authorization: `Bearer ${token}` }, env: {} };
      }
      if (config.secretKey === 'agent_mcp_ingress') {
        const token = this.configService?.get<string>('agentMcp.mcpIngressToken', '') ?? '';
        if (!token) {
          this.logger.warn('Agent MCP ingress token is not configured');
          return empty;
        }
        return { headers: { Authorization: `Bearer ${token}` }, env: {} };
      }
      return empty;
    }

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
      const credentialId = connector.credentialId;
      try {
        const credential = credentialId
          ? await this.credentialService.findByIdRaw(credentialId, userId)
          : connector.connectorId
            ? await this.credentialService.findActiveByConnectorId(connector.connectorId, userId)
            : null;
        if (!credential || credential.status !== 'active') {
          this.logger.warn('Credential not found or not active', {
            credentialId,
            connectorId: connector.connectorId,
          });
          return this.buildStaticHeaderAuth(config);
        }
        const token = credential.authPayload?.token as string | undefined;
        if (!token) {
          this.logger.warn('Credential has no token in authPayload', { credentialId });
          return this.buildStaticHeaderAuth(config);
        }
        return this.buildAuthMaterial(strategy, token, config);
      } catch (error) {
        this.logger.warn('Failed to resolve credential token', {
          credentialId,
          userId,
          error: (error as Error).message,
        });
        return empty;
      }
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
      const headerPrefix = typeof config.headerPrefix === 'string' ? config.headerPrefix : 'Bearer ';
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

  private buildStaticHeaderAuth(config: Record<string, unknown>): { headers: Record<string, string>; env: Record<string, string> } {
    if (config.strategy !== 'http_header_bearer') {
      return { headers: {}, env: {} };
    }

    const headerValue = typeof config.headerPrefix === 'string' ? config.headerPrefix.trim() : '';
    if (!headerValue) {
      return { headers: {}, env: {} };
    }

    const headerName = typeof config.headerName === 'string' && config.headerName.trim()
      ? config.headerName
      : 'Authorization';
    return { headers: { [headerName]: headerValue }, env: {} };
  }
}

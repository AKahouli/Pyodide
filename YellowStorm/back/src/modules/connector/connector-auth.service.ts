import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger';
import { ConnectedAppTokenService } from '../connected-app/services/connected-app-token.service';
import { UserService } from '../user/user.service';
import { ConnectorCredentialService } from './connector-credential.service';
import { ConnectorAuthService, ConnectorDynamicHeaderConfig } from './interfaces/connector-auth.interface';
import { DynamicHeaderSource } from './connector.types';
import { CryptoService } from '@common/services/crypto.service';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { assertNoUrlCredentials } from './utils/remote-mcp-transport.util';

export const ENCRYPTED_CONNECTOR_HEADERS = 'encrypted_server_headers_v1';
export const PORTABLE_CONNECTOR_HEADERS = 'portable_server_headers_v1';
export interface QueryHeaderMigrationPlan {
  expectedSecurityRevision: number;
  mappings: { queryKey: string; headerName: string; prefix: string }[];
  removeQueryKeys: string[];
}

function headerFailure(): never {
  throw new BadRequestException(ErrorCode.INVALID_TOKEN, 'Encrypted connector authentication is unavailable or invalid');
}

export function assertConnectorHeaderName(name: string): void {
  if (typeof name !== 'string' || !/^(?:Authorization|Api-Key|X-[a-z0-9]+(?:-[a-z0-9]+)*)$/i.test(name)
    || /^(?:x-yellowstorm-|x-user-|x-workspace-|x-sandbox-|x-internal-|x-forwarded-)/i.test(name)) headerFailure();
}

function requireHeaderCrypto(crypto?: CryptoService, config?: ConfigService): CryptoService {
  // Never let this new credential store silently use CryptoService's legacy dev-key fallback.
  if (!crypto || !/^[a-f0-9]{64}$/i.test(config?.get<string>('app.encryptionKey')?.trim() || '')) headerFailure();
  return crypto;
}

export function sealConnectorHeaders(crypto: CryptoService | undefined, config: ConfigService | undefined,
  connectorId: string, destination: string, headers: Record<string, string>, migration?: QueryHeaderMigrationPlan): Record<string, unknown> {
  try {
    assertNoUrlCredentials(destination);
    if (!connectorId || !Object.keys(headers).length) headerFailure();
    const names = new Set<string>();
    for (const [name, value] of Object.entries(headers)) {
      assertConnectorHeaderName(name);
      if (names.has(name.toLowerCase()) || typeof value !== 'string' || !value.trim() || value.length > 8192 || /[\x00-\x1f\x7f]/.test(value)) headerFailure();
      names.add(name.toLowerCase());
    }
    const encryptedHeaders = requireHeaderCrypto(crypto, config).encrypt(JSON.stringify({
      purpose: ENCRYPTED_CONNECTOR_HEADERS, connectorId, destination, headers, migration,
    }));
    return { strategy: ENCRYPTED_CONNECTOR_HEADERS, destination, encryptedHeaders };
  } catch { return headerFailure(); }
}

export function openConnectorHeaders(crypto: CryptoService | undefined, config: ConfigService | undefined,
  connectorId: string, runtime: Record<string, unknown>): { headers: Record<string, string>; migration?: QueryHeaderMigrationPlan } {
  try {
    if (runtime.strategy !== ENCRYPTED_CONNECTOR_HEADERS || typeof runtime.destination !== 'string'
      || typeof runtime.encryptedHeaders !== 'string' || !connectorId) headerFailure();
    assertNoUrlCredentials(runtime.destination);
    const payload = JSON.parse(requireHeaderCrypto(crypto, config).decrypt(runtime.encryptedHeaders)) as {
      purpose: string; connectorId: string; destination: string; headers: Record<string, string>;
      migration?: QueryHeaderMigrationPlan;
    };
    if (payload.purpose !== ENCRYPTED_CONNECTOR_HEADERS || payload.connectorId !== connectorId || payload.destination !== runtime.destination
      || !payload.headers || typeof payload.headers !== 'object' || Array.isArray(payload.headers) || !Object.keys(payload.headers).length) headerFailure();
    const seen = new Set<string>();
    for (const [name, value] of Object.entries(payload.headers)) {
      assertConnectorHeaderName(name);
      if (seen.has(name.toLowerCase()) || typeof value !== 'string' || !value.trim() || value.length > 8192 || /[\x00-\x1f\x7f]/.test(value)) headerFailure();
      seen.add(name.toLowerCase());
    }
    return { headers: payload.headers, migration: payload.migration };
  } catch { return headerFailure(); }
}

@Injectable()
export class ConnectorAuthServiceImpl implements ConnectorAuthService {
  constructor(
    private readonly connectedAppTokenService: ConnectedAppTokenService,
    private readonly credentialService: ConnectorCredentialService,
    private readonly userService: UserService,
    private readonly logger: LoggerService,
    @Optional() private readonly configService?: ConfigService,
    @Optional() private readonly cryptoService?: CryptoService,
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
      user = (await this.userService.findById(userId));
    } catch (error) {
      this.logger.warn('Failed to load user for dynamic header resolution', {
        userId,
        errorKind: error instanceof Error ? 'error' : 'non_error',
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

    if (connector.runtimeAuthConfig?.strategy === ENCRYPTED_CONNECTOR_HEADERS) {
      if (connector.authSourceType !== 'server_config' || connector.connectedAppKey) headerFailure();
      return { headers: openConnectorHeaders(this.cryptoService, this.configService, connector.connectorId || '', connector.runtimeAuthConfig).headers, env: {} };
    }
    if (connector.runtimeAuthConfig?.strategy === PORTABLE_CONNECTOR_HEADERS || connector.runtimeAuthConfig?.encryptedHeaders !== undefined) headerFailure();

    if (!connector.authSourceType || connector.authSourceType === 'none') {
      return empty;
    }

    const config = connector.runtimeAuthConfig || {};
    const strategy = (config.strategy as string) || 'http_header_bearer';

    if (connector.authSourceType === 'server_config') {
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
          errorKind: error instanceof Error ? 'error' : 'non_error',
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
          errorKind: error instanceof Error ? 'error' : 'non_error',
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
    if (config.strategy === 'custom_headers') {
      const mappings = config.headerMappings;
      if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) return { headers: {}, env: {} };
      const entries = Object.entries(mappings);
      // Static credentials are explicit per-connector values. A template that
      // needs a missing user credential must never be sent unresolved.
      if (entries.some(([, value]) => typeof value !== 'string' || !value.trim() || value.includes('{token}'))) {
        return { headers: {}, env: {} };
      }
      return { headers: Object.fromEntries(entries) as Record<string, string>, env: {} };
    }
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

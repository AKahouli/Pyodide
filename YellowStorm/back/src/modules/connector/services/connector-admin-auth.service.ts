import * as crypto from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { withTransaction } from '@common/postgres/transaction';
import { CryptoService } from '@common/services/crypto.service';
import { BadRequestException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { LoggerService } from '@modules/logger';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { AdminConnectorAuthStatus } from '../connector.types';
import {
  CONNECTOR_ADMIN_AUTH_STORE,
  CONNECTOR_ADMIN_OAUTH_STATE_STORE,
  type ConnectorAdminAuthRow,
  type ConnectorAdminAuthStore,
  type ConnectorAdminOauthStateStore,
} from '../persistence/connector.store';
import { ConnectedAppDefinitionService } from '../../connected-app/services/connected-app-definition.service';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * Failure outcome of a refresh whose status was already written inside the
 * transaction — returned (not thrown) so the write can commit (R-06).
 */
type RefreshOutcome = { ok: true; token: string } | { ok: false; message: string };

const escapeHtml = (v: string): string => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

@Injectable()
export class ConnectorAdminAuthService {
  private readonly frontendUrl: string;
  private readonly backendUrl: string;

  constructor(
    @Inject(CONNECTOR_ADMIN_OAUTH_STATE_STORE)
    private readonly oauthStateStore: ConnectorAdminOauthStateStore,
    @Inject(CONNECTOR_ADMIN_AUTH_STORE)
    private readonly authStore: ConnectorAdminAuthStore,
    @Inject(DRIZZLE_DB) private readonly pgDb: NodePgDatabase<typeof schema>,
    private readonly cryptoService: CryptoService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly connectedAppDefinitionService: ConnectedAppDefinitionService,
  ) {
    this.logger.setContext(ConnectorAdminAuthService.name);
    this.frontendUrl = this.configService.get<string>('app.frontendUrl', 'http://localhost:5173');
    this.backendUrl = this.configService.get<string>('app.backendUrl', 'http://localhost:3000');
  }

  async buildAuthorizationUrl(userId: string, appKey: string): Promise<string> {
    const appConfig = await this.getOAuthConfig(appKey);
    const state = crypto.randomBytes(32).toString('hex');

    let codeVerifier: string | undefined;
    let codeChallenge: string | undefined;

    if (appConfig.pkceEnabled) {
      codeVerifier = this.generateCodeVerifier();
      codeChallenge = this.generateCodeChallenge(codeVerifier);
    }

    await this.oauthStateStore.create({
      state,
      appKey: appConfig.appKey,
      userId,
      codeVerifier,
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    });

    const redirectUri = this.getRedirectUri(appConfig.appKey);
    const params = new URLSearchParams({
      client_id: appConfig.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: appConfig.scopes.join(' '),
      state,
    });

    if (codeChallenge) {
      params.set('code_challenge', codeChallenge);
      params.set('code_challenge_method', 'S256');
    }

    return `${appConfig.authorizationUrl}?${params.toString()}`;
  }

  async handleCallback(
    appKey: string,
    code: string,
    state: string,
  ): Promise<{ success: boolean; appKey: string; error?: string }> {
    // Atomic consume: expired states are deleted as invalid (plan 3.3).
    const oauthState = await this.oauthStateStore.consume(state);
    if (!oauthState) {
      throw new BadRequestException(
        ErrorCode.CONNECTED_APP_OAUTH_STATE_INVALID,
        'Invalid or expired OAuth state',
      );
    }

    if (oauthState.appKey !== appKey) {
      throw new BadRequestException(
        ErrorCode.CONNECTED_APP_OAUTH_STATE_INVALID,
        'State app key mismatch',
      );
    }

    const appConfig = await this.getOAuthConfig(appKey);
    const redirectUri = this.getRedirectUri(appKey);
    const tokenResponse = await this.exchangeCodeForTokens(
      appConfig.tokenUrl,
      code,
      redirectUri,
      appConfig.clientId,
      appConfig.clientSecret,
      oauthState.codeVerifier || undefined,
    );

    const accessToken =
      typeof tokenResponse.access_token === 'string' ? tokenResponse.access_token : undefined;
    const refreshToken =
      typeof tokenResponse.refresh_token === 'string' ? tokenResponse.refresh_token : undefined;
    const expiresIn =
      typeof tokenResponse.expires_in === 'number' ? tokenResponse.expires_in : undefined;
    if (!accessToken) {
      throw new BadRequestException(
        ErrorCode.CONNECTED_APP_OAUTH_FAILED,
        'OAuth token exchange failed',
      );
    }

    await this.authStore.upsertOnCallback(oauthState.userId, appKey, {
      accessToken: this.cryptoService.encrypt(accessToken),
      refreshToken: refreshToken ? this.cryptoService.encrypt(refreshToken) : null,
      tokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
      scopes: appConfig.scopes,
    });

    return { success: true, appKey };
  }

  async getStatus(userId: string, appKey: string): Promise<{
    appKey: string;
    connected: boolean;
    status?: AdminConnectorAuthStatus;
    connectedAt?: Date;
    disconnectedAt?: Date;
    providerEmail?: string;
  }> {
    const record = await this.authStore.findByUserAndApp(userId, appKey);

    return {
      appKey,
      connected: Boolean(record?.connected),
      status: record?.status as AdminConnectorAuthStatus | undefined,
      connectedAt: record?.createdAt,
      disconnectedAt: record?.disconnectedAt ?? undefined,
      providerEmail: record?.providerEmail ?? undefined,
    };
  }

  async getValidToken(userId: string, appKey: string): Promise<string> {
    const record = await this.authStore.findConnected(userId, appKey);

    if (!record || !record.accessToken) {
      throw new NotFoundException(
        ErrorCode.CONNECTED_APP_NOT_CONNECTED,
        `Admin is not connected to '${appKey}'`,
      );
    }

    const now = new Date();
    if (record.tokenExpiresAt && record.tokenExpiresAt.getTime() - TOKEN_EXPIRY_BUFFER_MS < now.getTime()) {
      return this.refreshAccessToken(record, appKey);
    }

    // Throttled: at most one write per minute per row (plan 3.2).
    await this.authStore.touchLastUsedThrottled(record.id);
    return this.cryptoService.decrypt(record.accessToken);
  }

  async disconnect(userId: string, appKey: string): Promise<void> {
    const record = await this.authStore.findByUserAndApp(userId, appKey);
    if (!record) {
      throw new NotFoundException(
        ErrorCode.CONNECTED_APP_NOT_CONNECTED,
        `Admin is not connected to '${appKey}'`,
      );
    }

    try {
      const appConfig = await this.getOAuthConfig(appKey);
      if (appConfig.revokeUrl && record.accessToken) {
        const token = this.cryptoService.decrypt(record.accessToken);
        await this.revokeTokenAtProvider(appConfig.revokeUrl, token);
      }
    } catch (error) {
      this.logger.warn('Admin connector token revocation failed (best-effort)', {
        appKey,
        error: (error as Error).message,
      });
    }

    await this.authStore.markDisconnected(record.id, {
      status: AdminConnectorAuthStatus.REVOKED,
      disconnectedAt: new Date(),
    });
  }

  buildCallbackHtml(appKey: string, success: boolean, error?: string): string {
    const payload = JSON.stringify({
      type: 'connector-admin-oauth-result',
      appKey,
      success,
      error: error || undefined,
    }).replace(/</g, '\\u003c');

    const statusMessage = success
      ? '<p style="color:green">Connected successfully. You can close this window.</p>'
      : `<p style="color:red">Connection failed: ${escapeHtml(error || 'unknown error')}</p>`;

    return `<!DOCTYPE html>
<html>
<head><title>Connecting...</title></head>
<body>
${statusMessage}
<script>
  if (window.opener) {
    window.opener.postMessage(${payload}, '${this.frontendUrl}');
  }
  ${success ? 'setTimeout(function() { window.close(); }, 500);' : ''}
</script>
</body>
</html>`;
  }

  /**
   * Single-flight refresh (plan 3.2): row lock + expiry re-check under the transaction.
   * Failures that write a terminal status return an outcome instead of throwing
   * inside the transaction — a throw would roll the status write back and the
   * record would never surface `expired`/`error` (remediation plan 3.1 / R-06).
   */
  private async refreshAccessToken(
    record: ConnectorAdminAuthRow,
    appKey: string,
  ): Promise<string> {
    const outcome = await withTransaction(this.pgDb, async (): Promise<RefreshOutcome> => {
      const locked = (await this.authStore.findByIdForUpdate(record.id))!;
      if (!locked || !locked.connected) {
        // Writes nothing — safe to throw.
        throw new BadRequestException(
          ErrorCode.CONNECTED_APP_TOKEN_REFRESH_FAILED,
          'Admin connection is no longer active. Please reconnect.',
        );
      }

      // Re-check under the lock: another caller may have refreshed already.
      const stillExpiring =
        !locked.tokenExpiresAt ||
        locked.tokenExpiresAt.getTime() - TOKEN_EXPIRY_BUFFER_MS < Date.now();
      if (!stillExpiring) {
        return { ok: true, token: this.cryptoService.decrypt(locked.accessToken!) };
      }

      if (!locked.refreshToken) {
        await this.authStore.markStatus(
          locked.id,
          AdminConnectorAuthStatus.EXPIRED,
          'No refresh token available',
        );
        return { ok: false, message: 'No refresh token available. Please reconnect.' };
      }

      const appConfig = await this.getOAuthConfig(appKey);

      const response = await fetch(appConfig.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.cryptoService.decrypt(locked.refreshToken),
          client_id: appConfig.clientId,
          client_secret: appConfig.clientSecret,
        }).toString(),
      });

      if (!response.ok) {
        await this.authStore.markStatus(
          locked.id,
          AdminConnectorAuthStatus.ERROR,
          `Token refresh failed: ${response.status}`,
        );
        return { ok: false, message: 'Failed to refresh token. Please reconnect.' };
      }

      const tokenResponse = await response.json() as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };

      if (!tokenResponse.access_token) {
        // Writes nothing — safe to throw.
        throw new BadRequestException(
          ErrorCode.CONNECTED_APP_TOKEN_REFRESH_FAILED,
          'Failed to refresh token. Please reconnect.',
        );
      }

      await this.authStore.applyRefresh(locked.id, {
        accessToken: this.cryptoService.encrypt(tokenResponse.access_token),
        refreshToken: tokenResponse.refresh_token
          ? this.cryptoService.encrypt(tokenResponse.refresh_token)
          : locked.refreshToken ?? undefined,
        tokenExpiresAt: tokenResponse.expires_in
          ? new Date(Date.now() + tokenResponse.expires_in * 1000)
          : null,
      });

      return { ok: true, token: tokenResponse.access_token };
    });

    if (!outcome.ok) {
      throw new BadRequestException(ErrorCode.CONNECTED_APP_TOKEN_REFRESH_FAILED, outcome.message);
    }
    return outcome.token;
  }

  private async exchangeCodeForTokens(
    tokenUrl: string,
    code: string,
    redirectUri: string,
    clientId: string,
    clientSecret: string,
    codeVerifier?: string,
  ): Promise<Record<string, unknown>> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });

    if (codeVerifier) {
      body.set('code_verifier', codeVerifier);
    }

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new BadRequestException(
        ErrorCode.CONNECTED_APP_OAUTH_FAILED,
        'OAuth token exchange failed',
      );
    }

    const data = await response.json() as Record<string, unknown>;
    if (data.error) {
      throw new BadRequestException(
        ErrorCode.CONNECTED_APP_OAUTH_FAILED,
        String(data.error_description || data.error),
      );
    }

    return data;
  }

  private async revokeTokenAtProvider(revokeUrl: string, token: string): Promise<void> {
    const response = await fetch(revokeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    });

    if (!response.ok) {
      this.logger.warn('Admin connector token revocation returned non-OK', {
        status: response.status,
      });
    }
  }

  private generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  private generateCodeChallenge(codeVerifier: string): string {
    return crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  }

  private async getOAuthConfig(appKey: string): Promise<{
    appKey: string;
    authorizationUrl: string;
    tokenUrl: string;
    revokeUrl?: string;
    clientId: string;
    clientSecret: string;
    scopes: string[];
    pkceEnabled: boolean;
  }> {
    const appDefinition = await this.connectedAppDefinitionService.findByKey(appKey);

    return {
      appKey: appDefinition.appKey,
      authorizationUrl: appDefinition.authorizationUrl,
      tokenUrl: appDefinition.tokenUrl,
      revokeUrl: appDefinition.revokeUrl,
      clientId: appDefinition.clientId,
      clientSecret: appDefinition.clientSecret,
      scopes: appDefinition.scopes,
      pkceEnabled: appDefinition.pkceEnabled,
    };
  }

  private getRedirectUri(appKey: string): string {
    const apiPrefix = this.configService.get<string>('app.apiPrefix', 'api');
    return `${this.backendUrl}/${apiPrefix}/v1/connected-apps/${appKey}/callback`;
  }
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { ConnectionStatus } from '../connected-app.types';
import { ConnectedAppDefinitionService } from './connected-app-definition.service';
import { CryptoService } from '@common/services/crypto.service';
import { LoggerService } from '@modules/logger';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { PgConnectedAppOauthStateStore } from '../persistence/pg-connected-app.store';
import { PgUserAppConnectionStore } from '../persistence/pg-connected-app.store';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class ConnectedAppOAuthService {
  private readonly frontendUrl: string;
  private readonly backendUrl: string;

  constructor(
    private readonly oauthStateStore: PgConnectedAppOauthStateStore,
    private readonly connectionStore: PgUserAppConnectionStore,
    private readonly definitionService: ConnectedAppDefinitionService,
    private readonly cryptoService: CryptoService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ConnectedAppOAuthService.name);
    this.frontendUrl = this.configService.get<string>('app.frontendUrl', 'http://localhost:5173');
    this.backendUrl = this.configService.get<string>('app.backendUrl', 'http://localhost:3000');
  }

  async buildAuthorizationUrl(userId: string, appKey: string): Promise<string> {
    const appConfig = await this.definitionService.findByKey(appKey);

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

    const apiPrefix = this.configService.get<string>('app.apiPrefix', 'api');
    const redirectUri = `${this.backendUrl}/${apiPrefix}/v1/connected-apps/${appConfig.appKey}/callback`;

    const params = new URLSearchParams({
      client_id: appConfig.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      state,
    });

    // Add scopes if provided
    if (appConfig.scopes && appConfig.scopes.length > 0) {
      params.set('scope', appConfig.scopes.join(' '));
    }

    // Notion-specific parameter
    if (appConfig.appKey === 'notion') {
      params.set('owner', 'user');
    }

    if (codeChallenge) {
      params.set('code_challenge', codeChallenge);
      params.set('code_challenge_method', 'S256');
    }

    let authUrl = appConfig.tenantId
      ? appConfig.authorizationUrl.replace('{tenant}', appConfig.tenantId)
      : appConfig.authorizationUrl;
    // Remove any existing query parameters from the authorization URL
    const urlObj = new URL(authUrl);
    authUrl = `${urlObj.origin}${urlObj.pathname}`;

    return `${authUrl}?${params.toString()}`;
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

    const appConfig = await this.definitionService.findByKey(appKey);
    const apiPrefix = this.configService.get<string>('app.apiPrefix', 'api');
    const redirectUri = `${this.backendUrl}/${apiPrefix}/v1/connected-apps/${appKey}/callback`;

    const tokenResponse = await this.exchangeCodeForTokens(
      appConfig.tokenUrl,
      appConfig.tenantId,
      code,
      redirectUri,
      appConfig.clientId,
      appConfig.clientSecret,
      oauthState.codeVerifier ?? undefined,
    );

    const accessToken = tokenResponse.access_token;
    if (!accessToken) {
      this.logger.error('Connected app token exchange returned no access_token', { appKey });
      throw new BadRequestException(
        ErrorCode.CONNECTED_APP_OAUTH_FAILED,
        'OAuth token exchange failed',
      );
    }

    const encryptedAccessToken = this.cryptoService.encrypt(accessToken);
    const encryptedRefreshToken = tokenResponse.refresh_token
      ? this.cryptoService.encrypt(tokenResponse.refresh_token)
      : undefined;

    const tokenExpiresAt = tokenResponse.expires_in
      ? new Date(Date.now() + tokenResponse.expires_in * 1000)
      : undefined;

    await this.connectionStore.upsertOnCallback(oauthState.userId, appKey, {
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken ?? null,
      tokenExpiresAt: tokenExpiresAt ?? null,
      scopes: appConfig.scopes,
      status: ConnectionStatus.ACTIVE,
      errorMessage: null,
    });

    this.logger.log('Connected app OAuth completed', {
      userId: oauthState.userId.toString(),
      appKey,
    });

    return { success: true, appKey };
  }

  buildCallbackHtml(appKey: string, success: boolean, error?: string): string {
    // `error` comes from the public provider query string and `appKey` from the URL:
    // escape both for the HTML body and keep `<` out of the inline script payload so a
    // value containing "</script>" cannot break out (reflected XSS).
    const payload = JSON.stringify({
      type: 'connected-app-oauth-result',
      appKey,
      success,
      error: error || undefined,
    }).replace(/</g, '\\u003c');

    this.logger.log('Building callback HTML', { appKey, success, frontendUrl: this.frontendUrl });

    const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const statusMsg = success
      ? '<p style="color:green">Connected successfully. You can close this window.</p>'
      : `<p style="color:red">Connection failed: ${escapeHtml(error || 'unknown error')}</p>`;

    return `<!DOCTYPE html>
<html>
<head><title>Connecting...</title></head>
<body>
${statusMsg}
<script>
  if (window.opener) {
    window.opener.postMessage(${payload}, '${this.frontendUrl}');
  }
  ${success ? 'setTimeout(function() { window.close(); }, 500);' : ''}
</script>
</body>
</html>`;
  }

  private async exchangeCodeForTokens(
    tokenUrl: string,
    tenantId: string | undefined,
    code: string,
    redirectUri: string,
    clientId: string,
    clientSecret: string,
    codeVerifier?: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    let url = tokenUrl;
    if (tenantId) {
      url = url.replace('{tenant}', tenantId);
    }

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

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error('Connected app token exchange HTTP error', {
        status: response.status,
        body: errorBody,
      });
      throw new BadRequestException(
        ErrorCode.CONNECTED_APP_OAUTH_FAILED,
        'OAuth token exchange failed',
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json();

    if (data.error) {
      this.logger.error('Connected app token exchange returned error', {
        error: data.error,
        errorDescription: data.error_description,
      });
      throw new BadRequestException(
        ErrorCode.CONNECTED_APP_OAUTH_FAILED,
        data.error_description || data.error,
      );
    }

    return data;
  }

  private generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  private generateCodeChallenge(codeVerifier: string): string {
    return crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  }
}

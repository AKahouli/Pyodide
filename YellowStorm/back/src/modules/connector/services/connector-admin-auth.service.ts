import * as crypto from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CryptoService } from '@common/services/crypto.service';
import { BadRequestException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { LoggerService } from '@modules/logger';
import { ConnectedAppDefinitionService } from '@modules/connected-app/services/connected-app-definition.service';
import {
  AdminConnectorAuth,
  AdminConnectorAuthDocument,
  AdminConnectorAuthStatus,
} from '../schemas/admin-connector-auth.schema';
import {
  AdminConnectorOAuthState,
  AdminConnectorOAuthStateDocument,
} from '../schemas/admin-connector-oauth-state.schema';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

@Injectable()
export class ConnectorAdminAuthService {
  private readonly frontendUrl: string;
  private readonly backendUrl: string;

  constructor(
    @InjectModel(AdminConnectorOAuthState.name)
    private readonly oauthStateModel: Model<AdminConnectorOAuthStateDocument>,
    @InjectModel(AdminConnectorAuth.name)
    private readonly authModel: Model<AdminConnectorAuthDocument>,
    private readonly definitionService: ConnectedAppDefinitionService,
    private readonly cryptoService: CryptoService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ConnectorAdminAuthService.name);
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

    await this.oauthStateModel.create({
      state,
      appKey: appConfig.appKey,
      userId: new Types.ObjectId(userId),
      codeVerifier,
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    });

    const apiPrefix = this.configService.get<string>('app.apiPrefix', 'api');
    const redirectUri = `${this.backendUrl}/${apiPrefix}/v1/admin/connectors/oauth/${appConfig.appKey}/callback`;
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

    let authorizationUrl = appConfig.authorizationUrl;
    if (appConfig.tenantId) {
      authorizationUrl = authorizationUrl.replace('{tenant}', appConfig.tenantId);
    }

    return `${authorizationUrl}?${params.toString()}`;
  }

  async handleCallback(
    appKey: string,
    code: string,
    state: string,
  ): Promise<{ success: boolean; appKey: string; error?: string }> {
    const oauthState = await this.oauthStateModel.findOneAndDelete({ state }).exec();
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

    if (oauthState.expiresAt < new Date()) {
      throw new BadRequestException(
        ErrorCode.CONNECTED_APP_OAUTH_STATE_INVALID,
        'OAuth state has expired',
      );
    }

    const appConfig = await this.definitionService.findByKey(appKey);
    const apiPrefix = this.configService.get<string>('app.apiPrefix', 'api');
    const redirectUri = `${this.backendUrl}/${apiPrefix}/v1/admin/connectors/oauth/${appKey}/callback`;
    const tokenResponse = await this.exchangeCodeForTokens(
      appConfig.tokenUrl,
      appConfig.tenantId,
      code,
      redirectUri,
      appConfig.clientId,
      appConfig.clientSecret,
      oauthState.codeVerifier,
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

    await this.authModel.findOneAndUpdate(
      { userId: oauthState.userId, appKey },
      {
        $set: {
          accessToken: this.cryptoService.encrypt(accessToken),
          refreshToken: refreshToken
            ? this.cryptoService.encrypt(refreshToken)
            : undefined,
          tokenExpiresAt: expiresIn
            ? new Date(Date.now() + expiresIn * 1000)
            : undefined,
          scopes: appConfig.scopes,
          connected: true,
          status: AdminConnectorAuthStatus.ACTIVE,
          disconnectedAt: undefined,
          errorMessage: undefined,
          lastRefreshedAt: new Date(),
          lastUsedAt: new Date(),
        },
      },
      { upsert: true, new: true },
    ).exec();

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
    const record = await this.authModel
      .findOne({ userId: new Types.ObjectId(userId), appKey })
      .lean()
      .exec();

    return {
      appKey,
      connected: Boolean(record?.connected),
      status: record?.status,
      connectedAt: record?.createdAt,
      disconnectedAt: record?.disconnectedAt,
      providerEmail: record?.providerEmail,
    };
  }

  async getValidToken(userId: string, appKey: string): Promise<string> {
    const record = await this.authModel
      .findOne({ userId: new Types.ObjectId(userId), appKey, connected: true })
      .exec();

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

    await this.authModel.updateOne({ _id: record._id }, { $set: { lastUsedAt: now } }).exec();
    return this.cryptoService.decrypt(record.accessToken);
  }

  async disconnect(userId: string, appKey: string): Promise<void> {
    const record = await this.authModel.findOne({ userId: new Types.ObjectId(userId), appKey }).exec();
    if (!record) {
      throw new NotFoundException(
        ErrorCode.CONNECTED_APP_NOT_CONNECTED,
        `Admin is not connected to '${appKey}'`,
      );
    }

    try {
      const appConfig = await this.definitionService.findByKey(appKey);
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

    await this.authModel.updateOne(
      { _id: record._id },
      {
        $set: {
          connected: false,
          status: AdminConnectorAuthStatus.REVOKED,
          disconnectedAt: new Date(),
          accessToken: undefined,
          refreshToken: undefined,
          tokenExpiresAt: undefined,
          errorMessage: undefined,
        },
      },
    ).exec();
  }

  buildCallbackHtml(appKey: string, success: boolean, error?: string): string {
    const payload = JSON.stringify({
      type: 'connector-admin-oauth-result',
      appKey,
      success,
      error: error || undefined,
    });

    const statusMessage = success
      ? '<p style="color:green">Connected successfully. You can close this window.</p>'
      : `<p style="color:red">Connection failed: ${error || 'unknown error'}</p>`;

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

  private async refreshAccessToken(
    record: AdminConnectorAuthDocument,
    appKey: string,
  ): Promise<string> {
    if (!record.refreshToken) {
      await this.authModel.updateOne(
        { _id: record._id },
        {
          $set: {
            status: AdminConnectorAuthStatus.EXPIRED,
            errorMessage: 'No refresh token available',
          },
        },
      ).exec();
      throw new BadRequestException(
        ErrorCode.CONNECTED_APP_TOKEN_REFRESH_FAILED,
        'No refresh token available. Please reconnect.',
      );
    }

    const appConfig = await this.definitionService.findByKey(appKey);
    let tokenUrl = appConfig.tokenUrl;
    if (appConfig.tenantId) {
      tokenUrl = tokenUrl.replace('{tenant}', appConfig.tenantId);
    }

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.cryptoService.decrypt(record.refreshToken),
        client_id: appConfig.clientId,
        client_secret: appConfig.clientSecret,
      }).toString(),
    });

    if (!response.ok) {
      await this.authModel.updateOne(
        { _id: record._id },
        {
          $set: {
            status: AdminConnectorAuthStatus.ERROR,
            errorMessage: `Token refresh failed: ${response.status}`,
          },
        },
      ).exec();
      throw new BadRequestException(
        ErrorCode.CONNECTED_APP_TOKEN_REFRESH_FAILED,
        'Failed to refresh token. Please reconnect.',
      );
    }

    const tokenResponse = await response.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!tokenResponse.access_token) {
      throw new BadRequestException(
        ErrorCode.CONNECTED_APP_TOKEN_REFRESH_FAILED,
        'Failed to refresh token. Please reconnect.',
      );
    }

    await this.authModel.updateOne(
      { _id: record._id },
      {
        $set: {
          accessToken: this.cryptoService.encrypt(tokenResponse.access_token),
          refreshToken: tokenResponse.refresh_token
            ? this.cryptoService.encrypt(tokenResponse.refresh_token)
            : record.refreshToken,
          tokenExpiresAt: tokenResponse.expires_in
            ? new Date(Date.now() + tokenResponse.expires_in * 1000)
            : undefined,
          status: AdminConnectorAuthStatus.ACTIVE,
          errorMessage: undefined,
          lastRefreshedAt: new Date(),
          lastUsedAt: new Date(),
        },
      },
    ).exec();

    return tokenResponse.access_token;
  }

  private async exchangeCodeForTokens(
    tokenUrl: string,
    tenantId: string | undefined,
    code: string,
    redirectUri: string,
    clientId: string,
    clientSecret: string,
    codeVerifier?: string,
  ): Promise<Record<string, unknown>> {
    let resolvedTokenUrl = tokenUrl;
    if (tenantId) {
      resolvedTokenUrl = resolvedTokenUrl.replace('{tenant}', tenantId);
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

    const response = await fetch(resolvedTokenUrl, {
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
}

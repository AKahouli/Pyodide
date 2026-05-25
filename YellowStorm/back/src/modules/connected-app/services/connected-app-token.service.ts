import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  UserAppConnection,
  UserAppConnectionDocument,
  ConnectionStatus,
} from '../schemas/user-app-connection.schema';
import { ConnectedAppDefinitionService } from './connected-app-definition.service';
import { CryptoService } from '@common/services/crypto.service';
import { LoggerService } from '@modules/logger';
import { BadRequestException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { MailboxCapabilityResponse } from '../interfaces/connected-app.interface';

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;
const M365_MAIL_APP_KEYS = ['microsoft365', 'microsoft', 'm365'];
const REQUIRED_MAILBOX_SCOPES = ['mail.read'];

@Injectable()
export class ConnectedAppTokenService {
  constructor(
    @InjectModel(UserAppConnection.name)
    private readonly connectionModel: Model<UserAppConnectionDocument>,
    private readonly definitionService: ConnectedAppDefinitionService,
    private readonly cryptoService: CryptoService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ConnectedAppTokenService.name);
  }

  async getValidToken(userId: string, appKey: string): Promise<string> {
    const appConfig = await this.definitionService.findByKey(appKey);

    // For API key type, return the API key from the app definition
    if (appConfig.authType === 'api_key') {
      if (!appConfig.apiKey) {
        throw new BadRequestException(
          ErrorCode.BAD_REQUEST,
          `API key not configured for '${appKey}'`,
        );
      }
      return appConfig.apiKey;
    }

    // For OAuth2 type, use existing connection-based logic
    const connection = await this.connectionModel
      .findOne({ userId: new Types.ObjectId(userId), appKey, status: ConnectionStatus.ACTIVE })
      .exec();

    if (!connection) {
      throw new NotFoundException(
        ErrorCode.CONNECTED_APP_NOT_CONNECTED,
        `User is not connected to '${appKey}'`,
      );
    }

    const now = new Date();
    if (
      connection.tokenExpiresAt &&
      connection.tokenExpiresAt.getTime() - TOKEN_EXPIRY_BUFFER_MS < now.getTime()
    ) {
      return this.refreshAccessToken(connection, appKey);
    }

    await this.connectionModel.updateOne(
      { _id: connection._id },
      { $set: { lastUsedAt: now } },
    );

    return this.cryptoService.decrypt(connection.accessToken);
  }

  async isConnected(userId: string, appKey: string): Promise<boolean> {
    const appConfig = await this.definitionService.findByKey(appKey);

    // For API key type, the app is always considered "connected" if it's enabled
    if (appConfig.authType === 'api_key') {
      return true;
    }

    // For OAuth2 type, check for user connection
    const count = await this.connectionModel.countDocuments({
      userId: new Types.ObjectId(userId),
      appKey,
      status: ConnectionStatus.ACTIVE,
    });
    return count > 0;
  }

  async requireConnection(userId: string, appKey: string): Promise<string> {
    return this.getValidToken(userId, appKey);
  }

  async getMailboxCapability(userId: string): Promise<MailboxCapabilityResponse> {
    for (const appKey of M365_MAIL_APP_KEYS) {
      const connection = await this.connectionModel
        .findOne({ userId: new Types.ObjectId(userId), appKey, status: ConnectionStatus.ACTIVE })
        .lean()
        .exec();

      if (!connection) {
        continue;
      }

      const grantedScopes = Array.isArray(connection.scopes) ? connection.scopes : [];
      const grantedScopesLower = new Set(grantedScopes.map((scope) => scope.toLowerCase()));
      const missingScopes = REQUIRED_MAILBOX_SCOPES.filter(
        (scope) => !grantedScopesLower.has(scope.toLowerCase()),
      );

      return {
        appKey,
        connected: true,
        mailboxReady: missingScopes.length === 0,
        providerEmail: connection.providerEmail,
        missingScopes,
        grantedScopes,
      };
    }

    return {
      appKey: M365_MAIL_APP_KEYS[0],
      connected: false,
      mailboxReady: false,
      providerEmail: undefined,
      missingScopes: [...REQUIRED_MAILBOX_SCOPES],
      grantedScopes: [],
    };
  }

  async disconnect(userId: string, appKey: string): Promise<void> {
    const connection = await this.connectionModel.findOne({ userId: new Types.ObjectId(userId), appKey }).exec();
    if (!connection) {
      throw new NotFoundException(
        ErrorCode.CONNECTED_APP_NOT_CONNECTED,
        `User is not connected to '${appKey}'`,
      );
    }

    try {
      const appConfig = await this.definitionService.findByKey(appKey);
      if (appConfig.revokeUrl && connection.accessToken) {
        const decryptedToken = this.cryptoService.decrypt(connection.accessToken);
        await this.revokeTokenAtProvider(appConfig.revokeUrl, decryptedToken);
      }
    } catch (error) {
      this.logger.warn('Token revocation failed (best-effort)', {
        appKey,
        error: (error as Error).message,
      });
    }

    await this.connectionModel.deleteOne({ _id: connection._id });

    this.logger.log('User disconnected from app', { userId, appKey });
  }

  private async refreshAccessToken(
    connection: UserAppConnectionDocument,
    appKey: string,
  ): Promise<string> {
    if (!connection.refreshToken) {
      await this.connectionModel.updateOne(
        { _id: connection._id },
        { $set: { status: ConnectionStatus.EXPIRED, errorMessage: 'No refresh token available' } },
      );
      throw new BadRequestException(
        ErrorCode.CONNECTED_APP_TOKEN_REFRESH_FAILED,
        'No refresh token available. Please reconnect.',
      );
    }

    const appConfig = await this.definitionService.findByKey(appKey);

    // Validate required OAuth fields
    if (!appConfig.tokenUrl || !appConfig.clientId || !appConfig.clientSecret) {
      await this.connectionModel.updateOne(
        { _id: connection._id },
        { $set: { status: ConnectionStatus.ERROR, errorMessage: 'OAuth configuration missing' } },
      );
      throw new BadRequestException(
        ErrorCode.CONNECTED_APP_TOKEN_REFRESH_FAILED,
        'OAuth configuration missing. Please reconnect.',
      );
    }

    const decryptedRefreshToken = this.cryptoService.decrypt(connection.refreshToken);

    let tokenUrl = appConfig.tokenUrl;
    if (appConfig.tenantId) {
      tokenUrl = tokenUrl.replace('{tenant}', appConfig.tenantId);
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: decryptedRefreshToken,
      client_id: appConfig.clientId,
      client_secret: appConfig.clientSecret,
    });

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error('Token refresh failed', {
          appKey,
          status: response.status,
          body: errorBody,
        });

        await this.connectionModel.findOneAndUpdate(
          { _id: connection._id, status: ConnectionStatus.ACTIVE },
          {
            $set: {
              status: ConnectionStatus.ERROR,
              errorMessage: `Token refresh failed: ${response.status}`,
            },
          },
        );

        throw new BadRequestException(
          ErrorCode.CONNECTED_APP_TOKEN_REFRESH_FAILED,
          'Failed to refresh token. Please reconnect.',
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tokenResponse: any = await response.json();

      const newAccessToken = tokenResponse.access_token;
      const newRefreshToken = tokenResponse.refresh_token;
      const expiresIn = tokenResponse.expires_in;

      await this.connectionModel.findOneAndUpdate(
        { _id: connection._id, status: ConnectionStatus.ACTIVE },
        {
          $set: {
            accessToken: this.cryptoService.encrypt(newAccessToken),
            ...(newRefreshToken && {
              refreshToken: this.cryptoService.encrypt(newRefreshToken),
            }),
            tokenExpiresAt: expiresIn
              ? new Date(Date.now() + expiresIn * 1000)
              : undefined,
            lastRefreshedAt: new Date(),
            lastUsedAt: new Date(),
            errorMessage: undefined,
          },
        },
      );

      this.logger.log('Token refreshed successfully', { appKey, userId: connection.userId });

      return newAccessToken;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;

      this.logger.error('Token refresh error', {
        appKey,
        error: (error as Error).message,
      });

      await this.connectionModel.findOneAndUpdate(
        { _id: connection._id, status: ConnectionStatus.ACTIVE },
        {
          $set: {
            status: ConnectionStatus.ERROR,
            errorMessage: (error as Error).message,
          },
        },
      );

      throw new BadRequestException(
        ErrorCode.CONNECTED_APP_TOKEN_REFRESH_FAILED,
        'Failed to refresh token. Please reconnect.',
      );
    }
  }

  private async revokeTokenAtProvider(revokeUrl: string, token: string): Promise<void> {
    const response = await fetch(revokeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    });

    if (!response.ok) {
      this.logger.warn('Provider token revocation returned non-OK', {
        status: response.status,
      });
    }
  }
}

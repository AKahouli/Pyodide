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

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

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

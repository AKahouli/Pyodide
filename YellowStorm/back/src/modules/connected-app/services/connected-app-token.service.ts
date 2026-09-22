import { Inject, Injectable } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { withTransaction } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import {
  USER_APP_CONNECTION_STORE,
  type UserAppConnectionRow,
  type UserAppConnectionStore,
} from '../persistence/connected-app.store';
import { ConnectionStatus } from '../connected-app.types';
import { ConnectedAppDefinitionService } from './connected-app-definition.service';
import { CryptoService } from '@common/services/crypto.service';
import { LoggerService } from '@modules/logger';
import { BadRequestException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { MailboxCapabilityResponse } from '../interfaces/connected-app.interface';

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;
const M365_MAIL_APP_KEYS = ['microsoft365', 'microsoft', 'm365'];
const REQUIRED_MAILBOX_SCOPES = ['mail.read'];

/**
 * Failure outcome of a refresh whose status was already written inside the
 * transaction — returned (not thrown) so the write can commit (R-06).
 */
type RefreshOutcome = { ok: true; token: string } | { ok: false; message: string };

@Injectable()
export class ConnectedAppTokenService {
  constructor(
    @Inject(USER_APP_CONNECTION_STORE)
    private readonly connectionStore: UserAppConnectionStore,
    @Inject(DRIZZLE_DB) private readonly pgDb: NodePgDatabase<typeof schema>,
    private readonly definitionService: ConnectedAppDefinitionService,
    private readonly cryptoService: CryptoService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ConnectedAppTokenService.name);
  }

  async getValidToken(userId: string, appKey: string): Promise<string> {
    const connection = await this.connectionStore.findActive(userId, appKey);

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

    // Throttled: at most one write per minute per row (plan 3.2).
    await this.connectionStore.touchLastUsedThrottled(connection.id);

    return this.cryptoService.decrypt(connection.accessToken);
  }

  async isConnected(userId: string, appKey: string): Promise<boolean> {
    return (await this.connectionStore.countActive(userId, appKey)) > 0;
  }

  async requireConnection(userId: string, appKey: string): Promise<string> {
    return this.getValidToken(userId, appKey);
  }

  /**
   * Resolves a valid M365 access token by trying all known app keys in order.
   * Returns both the token and the app key it was found under so callers can
   * persist the correct key. Falls back gracefully when the stored mailboxAppKey
   * doesn't match the actual connection key (e.g. 'microsoft' vs 'microsoft365').
   */
  async getM365ValidToken(userId: string, preferredAppKey?: string): Promise<{ token: string; appKey: string }> {
    const keysToTry = preferredAppKey
      ? [preferredAppKey, ...M365_MAIL_APP_KEYS.filter((k) => k !== preferredAppKey)]
      : M365_MAIL_APP_KEYS;

    for (const appKey of keysToTry) {
      const connection = await this.connectionStore.findActive(userId, appKey);
      if (!connection) continue;

      const now = new Date();
      if (connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() - TOKEN_EXPIRY_BUFFER_MS < now.getTime()) {
        const token = await this.refreshAccessToken(connection, appKey);
        return { token, appKey };
      }

      await this.connectionStore.touchLastUsedThrottled(connection.id);
      return { token: this.cryptoService.decrypt(connection.accessToken), appKey };
    }

    throw new NotFoundException(
      ErrorCode.CONNECTED_APP_NOT_CONNECTED,
      `User is not connected to any Microsoft 365 app`,
    );
  }

  async getMailboxCapability(userId: string): Promise<MailboxCapabilityResponse> {
    for (const appKey of M365_MAIL_APP_KEYS) {
      const connection = await this.connectionStore.findActive(userId, appKey);

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
        providerEmail: connection.providerEmail ?? undefined,
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
    const connection = await this.connectionStore.findByUserAndApp(userId, appKey);
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

    await this.connectionStore.deleteById(connection.id);

    this.logger.log('User disconnected from app', { userId, appKey });
  }

  /**
   * Single-flight refresh (plan 3.2): the refresh runs inside a transaction
   * holding SELECT … FOR UPDATE on the connection row. After acquiring the
   * lock, token expiry is re-checked — when a concurrent caller already
   * refreshed, the fresh token is decrypted and returned without another
   * provider call.
   *
   * Failures that write a terminal status return an outcome instead of
   * throwing inside the transaction: a throw would roll the status write back
   * and the connection would never surface `expired`/`error` (remediation
   * plan 3.1 / R-06).
   */
  private async refreshAccessToken(
    connection: UserAppConnectionRow,
    appKey: string,
  ): Promise<string> {
    const outcome = await withTransaction(this.pgDb, async (): Promise<RefreshOutcome> => {
      const locked = (await this.connectionStore.findByIdForUpdate(connection.id))!;
      if (!locked || locked.status !== ConnectionStatus.ACTIVE) {
        // Writes nothing — safe to throw.
        throw new BadRequestException(
          ErrorCode.CONNECTED_APP_TOKEN_REFRESH_FAILED,
          'Connection is no longer active. Please reconnect.',
        );
      }

      // Re-check under the lock: another caller may have refreshed already.
      const stillExpiring =
        !locked.tokenExpiresAt ||
        locked.tokenExpiresAt.getTime() - TOKEN_EXPIRY_BUFFER_MS < Date.now();
      if (!stillExpiring) {
        return { ok: true, token: this.cryptoService.decrypt(locked.accessToken) };
      }

      if (!locked.refreshToken) {
        await this.connectionStore.markInactive(
          locked.id,
          ConnectionStatus.EXPIRED,
          'No refresh token available',
        );
        return { ok: false, message: 'No refresh token available. Please reconnect.' };
      }

      const appConfig = await this.definitionService.findByKey(appKey);
      const decryptedRefreshToken = this.cryptoService.decrypt(locked.refreshToken);

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

          await this.connectionStore.markInactive(
            locked.id,
            ConnectionStatus.ERROR,
            `Token refresh failed: ${response.status}`,
          );

          return { ok: false, message: 'Failed to refresh token. Please reconnect.' };
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tokenResponse: any = await response.json();

        const newAccessToken = tokenResponse.access_token;
        const newRefreshToken = tokenResponse.refresh_token;
        const expiresIn = tokenResponse.expires_in;

        await this.connectionStore.applyRefresh(locked.id, {
          accessToken: this.cryptoService.encrypt(newAccessToken),
          refreshToken: newRefreshToken ? this.cryptoService.encrypt(newRefreshToken) : undefined,
          tokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
        });

        this.logger.log('Token refreshed successfully', { appKey, userId: locked.userId });

        return { ok: true, token: newAccessToken };
      } catch (error) {
        this.logger.error('Token refresh error', {
          appKey,
          error: (error as Error).message,
        });

        await this.connectionStore.markInactive(
          locked.id,
          ConnectionStatus.ERROR,
          (error as Error).message,
        );

        return { ok: false, message: 'Failed to refresh token. Please reconnect.' };
      }
    });

    if (!outcome.ok) {
      throw new BadRequestException(ErrorCode.CONNECTED_APP_TOKEN_REFRESH_FAILED, outcome.message);
    }
    return outcome.token;
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

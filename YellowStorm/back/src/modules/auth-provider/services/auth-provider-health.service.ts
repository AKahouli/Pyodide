import { Injectable } from '@nestjs/common';
import { CryptoService } from '@common/services/crypto.service';
import { LoggerService } from '@modules/logger';
import { PgAuthProviderStore } from '../persistence/pg-auth-provider.stores';

export interface AuthProviderHealthDetail {
  status: 'up' | 'down' | 'degraded';
  responseTime?: number;
  message?: string;
  lastChecked: string;
  providers?: ProviderHealthStatus[];
}

export interface ProviderHealthStatus {
  providerKey: string;
  displayName: string;
  enabled: boolean;
  decryptionOk: boolean;
  authorizationUrlReachable: boolean | null;
  error?: string;
}

@Injectable()
export class AuthProviderHealthService {
  constructor(
    private readonly providerStore: PgAuthProviderStore,
    private readonly cryptoService: CryptoService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(AuthProviderHealthService.name);
  }

  /**
   * Check health of all configured auth providers.
   * - No providers configured → up (optional feature)
   * - All providers healthy → up
   * - Some providers unhealthy → degraded
   * - All providers unhealthy → down
   */
  async check(): Promise<AuthProviderHealthDetail> {
    const startTime = Date.now();

    try {
      const providers = await this.providerStore.findAll();

      // No providers configured — feature is simply not in use, that's healthy
      if (providers.length === 0) {
        return {
          status: 'up',
          responseTime: Date.now() - startTime,
          message: 'No providers configured',
          lastChecked: new Date().toISOString(),
        };
      }

      // Check each provider in parallel
      const results = await Promise.all(
        providers.map((provider) => this.checkProvider(provider)),
      );

      const enabledResults = results.filter((r) => r.enabled);

      // No enabled providers — up but informational
      if (enabledResults.length === 0) {
        return {
          status: 'up',
          responseTime: Date.now() - startTime,
          message: `${results.length} provider(s) configured, none enabled`,
          lastChecked: new Date().toISOString(),
          providers: results,
        };
      }

      const healthyCount = enabledResults.filter(
        (r) => r.decryptionOk && r.authorizationUrlReachable !== false,
      ).length;
      const allHealthy = healthyCount === enabledResults.length;
      const noneHealthy = healthyCount === 0;

      let status: 'up' | 'down' | 'degraded';
      let message: string;

      if (allHealthy) {
        status = 'up';
        message = `${enabledResults.length} provider(s) healthy`;
      } else if (noneHealthy) {
        status = 'down';
        message = `All ${enabledResults.length} enabled provider(s) unhealthy`;
      } else {
        status = 'degraded';
        message = `${healthyCount}/${enabledResults.length} enabled provider(s) healthy`;
      }

      return {
        status,
        responseTime: Date.now() - startTime,
        message,
        lastChecked: new Date().toISOString(),
        providers: results,
      };
    } catch (error) {
      return {
        status: 'down',
        responseTime: Date.now() - startTime,
        message: `Health check failed: ${(error as Error).message}`,
        lastChecked: new Date().toISOString(),
      };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async checkProvider(provider: any): Promise<ProviderHealthStatus> {
    const result: ProviderHealthStatus = {
      providerKey: provider.providerKey,
      displayName: provider.displayName,
      enabled: provider.enabled,
      decryptionOk: false,
      authorizationUrlReachable: null,
    };

    // 1. Check decryption — can we read the secrets with the current key?
    try {
      this.cryptoService.decrypt(provider.clientId);
      this.cryptoService.decrypt(provider.clientSecret);
      if (provider.tenantId) {
        this.cryptoService.decrypt(provider.tenantId);
      }
      result.decryptionOk = true;
    } catch (error) {
      result.decryptionOk = false;
      result.error = `Decryption failed: ${(error as Error).message}`;
      // If decryption fails, no point checking URL
      return result;
    }

    // 2. Check authorization URL reachability (only for enabled providers)
    if (provider.enabled) {
      try {
        let authUrl = provider.authorizationUrl;
        // Replace tenant placeholder for URL check
        if (provider.tenantId) {
          const decryptedTenant = this.cryptoService.decrypt(provider.tenantId);
          authUrl = authUrl.replace('{tenant}', decryptedTenant);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => { controller.abort(); }, 5000);

        const response = await fetch(authUrl, {
          method: 'HEAD',
          signal: controller.signal,
          redirect: 'manual', // OAuth URLs typically redirect, that's expected
        });

        clearTimeout(timeout);

        // Any response (including 302, 400, 405) means the URL is reachable
        // Only network errors or timeouts mean it's unreachable
        result.authorizationUrlReachable = true;

        // Some providers don't support HEAD, so any HTTP response is fine
        if (response.status >= 500) {
          result.authorizationUrlReachable = false;
          result.error = `Authorization URL returned ${response.status}`;
        }
      } catch (error) {
        result.authorizationUrlReachable = false;
        result.error = `Authorization URL unreachable: ${(error as Error).message}`;
      }
    }

    return result;
  }
}

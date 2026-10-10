import type { ConfigService } from '@nestjs/config';

/** URI version applied to every controller by `app.enableVersioning` in main.ts. */
export const API_DEFAULT_VERSION = '1';

/** Global route prefix (`app.setGlobalPrefix` in main.ts), from the same config key. */
export function resolveApiPrefix(configService: ConfigService): string {
  return configService.get<string>('app.apiPrefix', 'api');
}

/**
 * Path of the `auth` controller as the browser sees it (global prefix + version + `auth`).
 * Scopes the refresh-token cookie so it is only sent to the auth endpoints.
 */
export function getAuthCookiePath(configService: ConfigService): string {
  return `/${resolveApiPrefix(configService)}/v${API_DEFAULT_VERSION}/auth`;
}

/**
 * Route path of a provider's OAuth callback. Single source for both the redirect URI sent to the
 * provider and the state-binding cookie scope, so they cannot drift. Pass the stored (lowercased)
 * provider key, not the raw route parameter.
 */
export function getOAuthCallbackPath(configService: ConfigService, providerKey: string): string {
  return `${getAuthCookiePath(configService)}/providers/${encodeURIComponent(providerKey)}/callback`;
}

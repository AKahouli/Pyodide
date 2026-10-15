/**
 * Builds an absolute frontend URL for a hash route (the SPA uses hash routing,
 * e.g. `/#/admin/users`). Trailing slashes on the configured base are ignored.
 */
export function buildFrontendHashUrl(baseUrl: string, hashPath = '/'): string {
  const base = baseUrl.replace(/\/+$/, '');
  const path = hashPath.startsWith('/') ? hashPath : `/${hashPath}`;
  return `${base}/#${path}`;
}

/**
 * Deployed apps are served under /apps/{sessionId}/ on apps.yellowsys.org.
 * Vite `base` (import.meta.env.BASE_URL) uses a trailing slash; React Router basename must not.
 */
export function resolveRouterBasename(): string {
  const base = import.meta.env.BASE_URL ?? '/';
  if (base === '/') return '';
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

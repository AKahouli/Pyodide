/**
 * Deployed apps are served under /apps/{sessionId}/ on apps.yellowsys.org.
 * Vite `base` (import.meta.env.BASE_URL) keeps a trailing slash for static hosting.
 * React Router `basename` must not have a trailing slash.
 */

/** Basename for <BrowserRouter> — no trailing slash (React Router contract). */
export function resolveRouterBasename(): string {
  const base = import.meta.env.BASE_URL ?? '/';
  if (base === '/') return '';
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

/**
 * Absolute home href including the trailing slash expected by the deploy host.
 * Prefer this over navigate('/') which resolves to /apps/{id} without '/'.
 */
export function resolveAppHomeHref(): string {
  const base = import.meta.env.BASE_URL ?? '/';
  if (base === '/') return '/';
  return base.endsWith('/') ? base : `${base}/`;
}

/** True when a React Router location path means the app index. */
export function isAppHomePath(path: string | null | undefined): boolean {
  return path == null || path === '' || path === '/';
}

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

/**
 * Rewrite `/apps/{id}` to `/apps/{id}/` in the address bar.
 * React Router renders the basename without a trailing slash, so call this at
 * bootstrap and after any navigation back to the app index. Uses replaceState
 * so the router keeps its own location and no reload/auth remount happens.
 */
export function ensureAppHomeTrailingSlash(): void {
  if (typeof window === 'undefined') return;
  const home = resolveAppHomeHref();
  if (home === '/') return;
  if (window.location.pathname !== home.slice(0, -1)) return;
  window.history.replaceState(
    window.history.state,
    '',
    `${home}${window.location.search}${window.location.hash}`,
  );
}

/** Public file under Vite `base` (works for `/` and `/apps/{id}/`). */
export function resolvePublicAsset(relativePath: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}${relativePath.replace(/^\//, '')}`;
}

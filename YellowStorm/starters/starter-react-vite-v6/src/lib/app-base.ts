/**
 * Deployed apps are served under /apps/{sessionId}/ on apps.yellowsys.org.
 * Vite `base` (import.meta.env.BASE_URL) keeps a trailing slash for static hosting.
 * React Router `basename` must not have a trailing slash — a trailing slash creates
 * `/apps/{id}//register` when linking to absolute paths like `/register`.
 */

/** Collapse repeated slashes (except the leading one). */
export function collapsePathSlashes(path: string): string {
  if (!path) return path;
  return path.replace(/\/{2,}/g, '/');
}

function normalizeBaseUrl(raw: string | undefined): string {
  const base = collapsePathSlashes((raw ?? '/').trim() || '/');
  if (base === '/') return '/';
  return base.startsWith('/') ? base : `/${base}`;
}

/** Basename for <BrowserRouter> — no trailing slash (React Router contract). */
export function resolveRouterBasename(): string {
  const base = normalizeBaseUrl(import.meta.env.BASE_URL);
  if (base === '/') return '';
  return base.replace(/\/+$/, '');
}

/**
 * Absolute home href including the trailing slash expected by the deploy host.
 * Prefer this over navigate('/') which resolves to /apps/{id} without '/'.
 */
export function resolveAppHomeHref(): string {
  const base = normalizeBaseUrl(import.meta.env.BASE_URL);
  if (base === '/') return '/';
  return base.endsWith('/') ? base : `${base}/`;
}

/** True when a React Router location path means the app index. */
export function isAppHomePath(path: string | null | undefined): boolean {
  return path == null || path === '' || path === '/';
}

/**
 * Join an in-app path onto the Vite base without producing `//`.
 * `path` may be `register`, `/register`, or `/register?invite=…`.
 */
export function joinAppPath(path: string): string {
  const home = resolveAppHomeHref().replace(/\/+$/, '');
  const [pathnamePart, query = ''] = path.split('?');
  const segment = collapsePathSlashes(`/${(pathnamePart || '').replace(/^\/+/, '')}`);
  const suffix = query ? `?${query}` : '';
  if (!home || home === '') return `${segment}${suffix}`;
  return `${home}${segment}${suffix}`;
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

/** Fix accidental `//` in the pathname (e.g. `/apps/id//register`). */
export function collapseDuplicateSlashesInLocation(): void {
  if (typeof window === 'undefined') return;
  const { pathname, search, hash } = window.location;
  if (!pathname.includes('//')) return;
  const cleaned = collapsePathSlashes(pathname);
  if (cleaned === pathname) return;
  window.history.replaceState(window.history.state, '', `${cleaned}${search}${hash}`);
}

/** Public file under Vite `base` (works for `/` and `/apps/{id}/`). */
export function resolvePublicAsset(relativePath: string): string {
  const prefix = resolveAppHomeHref();
  return `${prefix}${relativePath.replace(/^\//, '')}`;
}

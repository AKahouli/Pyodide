/** Canonical form used only for duplicate detection and Governance origin keys. */
export function normalizeWorkspaceUrl(value: string): string {
  const url = new URL(value.trim());
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1);
  return url.toString();
}

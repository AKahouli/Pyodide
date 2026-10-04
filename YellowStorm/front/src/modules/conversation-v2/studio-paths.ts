/** Public App Builder Studio routes (user-facing; replaces conversation-v2 URLs). */
export const STUDIO_BASE_PATH = '/studio';
export const STUDIO_HOME_PATH = STUDIO_BASE_PATH;
export const APP_MARKET_PATH = '/app-market';

/** Legacy path kept for redirects and bookmarks. */
export const LEGACY_CONVERSATION_V2_BASE = '/conversation-v2';

export function studioSessionPath(sessionId: string): string {
  return `${STUDIO_BASE_PATH}/${sessionId.trim()}`;
}

/** Query flag on `/studio/:sessionId?action=clone` — draft until first Send. */
export const CLONE_ACTION_QUERY = 'clone';

export function isCloneDraftSearch(searchParams: URLSearchParams): boolean {
  return searchParams.get('action') === CLONE_ACTION_QUERY;
}

/** Session route for a clone draft (real session id, draft marker in query only). */
export function studioCloneDraftPath(sessionId: string): string {
  return `${studioSessionPath(sessionId)}?action=${CLONE_ACTION_QUERY}`;
}

/** @deprecated Use studioCloneDraftPath — kept for call-site migration. */
export const conversationV2CloneDraftPath = studioCloneDraftPath;

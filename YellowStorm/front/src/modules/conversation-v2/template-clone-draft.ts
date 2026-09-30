/** Query flag on `/conversation-v2/:sessionId?action=clone` — draft until first Send. */
export const CLONE_ACTION_QUERY = 'clone';

export function isCloneDraftSearch(searchParams: URLSearchParams): boolean {
  return searchParams.get('action') === CLONE_ACTION_QUERY;
}

/** Session route for a clone draft (real session id, draft marker in query only). */
export function conversationV2CloneDraftPath(sessionId: string): string {
  return `/conversation-v2/${sessionId.trim()}?action=${CLONE_ACTION_QUERY}`;
}

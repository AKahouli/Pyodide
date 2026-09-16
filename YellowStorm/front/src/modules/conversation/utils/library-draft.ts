export interface LibraryDraft {
  id: string; name: string; kind: 'agent' | 'team'; text: string; key: string;
}
export function readLibraryDraft(state: unknown): LibraryDraft | undefined {
  if (!state || typeof state !== 'object' || !('libraryDraft' in state)) return undefined;
  const draft = state.libraryDraft;
  if (!draft || typeof draft !== 'object') return undefined;
  const value = draft as Record<string, unknown>;
  if ((value.kind !== 'agent' && value.kind !== 'team') || !['id', 'name', 'key'].every(key => typeof value[key] === 'string' && value[key].length > 0) || typeof value.text !== 'string') return undefined;
  return value as unknown as LibraryDraft;
}

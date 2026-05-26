/**
 * Persisted per-conversation model selection.
 *
 * Layout in localStorage: a single JSON object keyed by sessionId →
 * modelId, so we can keep all selections under one key and inspect or prune
 * them as a unit.
 *
 *   {
 *     "sess-abc": "gpt-4o",
 *     "sess-def": "claude-3-5-sonnet"
 *   }
 *
 * Sessions with no entry are treated as "use admin default" — the page reads
 * back null and the composer falls through to useDefaultModel().
 */

const STORAGE_KEY = 'conversation-v2:selected-models';

type SelectionMap = Record<string, string>;

function readMap(): SelectionMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as SelectionMap;
    }
    return {};
  } catch {
    // Corrupt JSON / quota error / sandboxed iframe — treat as "no selections".
    return {};
  }
}

function writeMap(map: SelectionMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota or storage disabled — selection just won't persist across reloads.
  }
}

export function readSelectedModelForSession(sessionId: string): string | null {
  const map = readMap();
  return map[sessionId] ?? null;
}

export function writeSelectedModelForSession(
  sessionId: string,
  modelId: string | null,
): void {
  const map = readMap();
  if (modelId === null) {
    delete map[sessionId];
  } else {
    map[sessionId] = modelId;
  }
  writeMap(map);
}

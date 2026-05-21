import type { PlaybookIntentSuggestion } from '../types';

function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, sortKeysDeep(entryValue)]),
  );
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function serializeSuggestion(playbookId: string, suggestion: PlaybookIntentSuggestion): string {
  return JSON.stringify(sortKeysDeep({ playbookId, suggestion }));
}

/**
 * Reapplying the same suggestion should recreate the same graph ids so retries
 * converge to one structure instead of appending duplicates.
 */
export function createIntentSuggestionApplicationKey(playbookId: string, suggestion: PlaybookIntentSuggestion): string {
  return `intent-${hashText(serializeSuggestion(playbookId, suggestion))}`;
}

export function createIntentSuggestionNodeId(applicationKey: string, logicalNodeKey: string): string {
  return `intent-node-${hashText(`${applicationKey}:${logicalNodeKey}`)}`;
}

export function createIntentSuggestionBindingId(
  applicationKey: string,
  targetNodeId: string,
  targetPort: string,
  sourceNodeId: string,
  sourcePort: string,
  iteration: 'current' | 'previous',
): string {
  return `intent-db-${hashText(`${applicationKey}:${targetNodeId}:${targetPort}:${sourceNodeId}:${sourcePort}:${iteration}`)}`;
}

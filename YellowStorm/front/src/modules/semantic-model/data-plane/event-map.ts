// Central event -> query-key mapping (P2.SB20). Pure functions, unit-tested.
// Signals are invalidation hints only: handlers refetch authoritative
// snapshots, never apply payloads. Stale revisions are ignored, never merged.
import type { SemanticBroadcastEvent, SemanticBroadcastPayload } from './semantic-api.types';
import { semanticDataKeys } from './semantic-query-keys';

/** Query-key prefixes to invalidate for an event, given the pinned revision. */
export function keysForEvent(
  modelId: string,
  dataRevision: string | null,
  event: SemanticBroadcastEvent,
): readonly (readonly unknown[])[] {
  switch (event) {
    case 'data-revision-changed':
      return [
        semanticDataKeys.entities(modelId, dataRevision),
        semanticDataKeys.relations(modelId, dataRevision),
        semanticDataKeys.reviews(modelId),
        semanticDataKeys.summary(modelId),
      ];
    case 'review-items-changed':
      return [semanticDataKeys.reviews(modelId), semanticDataKeys.summary(modelId)];
    case 'population-status-changed':
    case 'datasource-status-changed':
      return [semanticDataKeys.jobs(modelId), semanticDataKeys.summary(modelId)];
    case 'model-read-state-changed':
      return [semanticDataKeys.summary(modelId)];
  }
}

/** True when an incoming revision supersedes the cached one. */
export function isNewerRevision(cached: number | null, incoming: number | null | undefined): boolean {
  if (incoming == null) return true;
  if (cached == null) return true;
  return incoming > cached;
}

/** Validate an untrusted signal frame before acting on it. */
export function parseSignal(frame: unknown): SemanticBroadcastPayload | null {
  if (typeof frame !== 'object' || frame === null) return null;
  const payload = (frame as { payload?: unknown }).payload ?? frame;
  if (typeof payload !== 'object' || payload === null) return null;
  const { modelId, dataRevision } = payload as Record<string, unknown>;
  if (typeof modelId !== 'string' || !modelId) return null;
  if (dataRevision !== undefined && typeof dataRevision !== 'number') return null;
  return payload as SemanticBroadcastPayload;
}

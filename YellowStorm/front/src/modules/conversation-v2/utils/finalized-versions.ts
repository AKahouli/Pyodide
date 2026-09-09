import type { AgentEvent } from '../types';

export interface FinalizedAppVersion {
  revisionId: string;
  title: string;
  finalizedAt: string;
  fileCount?: number;
}

export function finalizedVersionsFromEvents(events: AgentEvent[]): FinalizedAppVersion[] {
  const byRevision = new Map<string, FinalizedAppVersion>();

  for (const event of events) {
    if (event.type !== 'application_component') continue;
    const revisionId = event.revision_id?.trim();
    if (!revisionId) continue;

    byRevision.set(revisionId, {
      revisionId,
      title: event.title?.trim() || 'App',
      finalizedAt: new Date(event.timestamp * 1000).toISOString(),
      ...(typeof event.file_count === 'number' ? { fileCount: event.file_count } : {}),
    });
  }

  return [...byRevision.values()].sort(
    (a, b) => Date.parse(b.finalizedAt) - Date.parse(a.finalizedAt),
  );
}

export function mergeFinalizedVersions(
  apiItems: FinalizedAppVersion[],
  eventItems: FinalizedAppVersion[],
): FinalizedAppVersion[] {
  const merged = new Map<string, FinalizedAppVersion>();

  for (const item of [...eventItems, ...apiItems]) {
    const existing = merged.get(item.revisionId);
    if (!existing || Date.parse(item.finalizedAt) >= Date.parse(existing.finalizedAt)) {
      merged.set(item.revisionId, item);
    }
  }

  return [...merged.values()].sort(
    (a, b) => Date.parse(b.finalizedAt) - Date.parse(a.finalizedAt),
  );
}

export function formatFinalizedDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function resolveLatestFinalizedRevisionId(
  versions: FinalizedAppVersion[],
): string | null {
  return versions[0]?.revisionId ?? null;
}

/**
 * Human-facing version number for a revision inside a latest-first list.
 * The oldest finalized version is "Version 1", the latest is "Version N".
 * The revisionId itself stays the durable identifier; this is display-only.
 */
export function resolveFinalizedVersionNumber(
  versions: FinalizedAppVersion[],
  revisionId: string | null,
): number | null {
  if (!revisionId) return null;
  const index = versions.findIndex((version) => version.revisionId === revisionId);
  return index === -1 ? null : versions.length - index;
}

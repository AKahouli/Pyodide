import type { IndexingStatus, WorkspaceFile } from '../types';

export interface SourceGroup {
  /** Grouping key: the per-batch source group id, or the normalized start URL (legacy). */
  key: string;
  /** Cleaned display label (host + path, no scheme). */
  label: string;
  /** Raw start URL, for the header tooltip. */
  rootUrl: string;
  /** The batch group id shared by these files (undefined for legacy root-URL groups). */
  sourceGroupId?: string;
  files: WorkspaceFile[];
  /** Aggregate indexing status across the group's files. */
  status: IndexingStatus;
}

/** A url-doc's grouping key: its per-batch group id, falling back to the normalized start URL. */
function groupKeyOf(f: WorkspaceFile): string | undefined {
  if (f.type !== 'url') return undefined;
  return f.sourceGroupId ?? f.normalizedSourceRootUrl;
}

export interface GroupedFiles {
  groups: SourceGroup[];
  loose: WorkspaceFile[];
}

function aggregateStatus(files: WorkspaceFile[]): IndexingStatus {
  const statuses = files.map((f) => f.indexingStatus ?? 'none');
  if (statuses.some((s) => s === 'failed')) return 'failed';
  if (statuses.some((s) => s === 'pending' || s === 'processing')) return 'processing';
  if (statuses.length > 0 && statuses.every((s) => s === 'ready')) return 'ready';
  return 'none';
}

function cleanRootLabel(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
    return `${u.host}${path}`;
  } catch {
    return rawUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
}

/**
 * Partition workspace files into groups and loose files. A group is one indexing
 * batch, identified by `sourceGroupId` (falling back to `normalizedSourceRootUrl`
 * for legacy docs) and labelled by its start URL — so two separate sessions on the
 * same URL form two distinct groups. A group forms only when 2+ url-documents share
 * the same key; every other file stays loose. First-seen order is preserved.
 */
export function groupBySourceRoot(files: WorkspaceFile[]): GroupedFiles {
  const counts = new Map<string, number>();
  for (const f of files) {
    const key = groupKeyOf(f);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const groupByKey = new Map<string, SourceGroup>();
  const order: string[] = [];
  const loose: WorkspaceFile[] = [];

  for (const f of files) {
    const key = groupKeyOf(f);
    if (key && (counts.get(key) ?? 0) >= 2) {
      let group = groupByKey.get(key);
      if (!group) {
        const rootUrl = f.sourceRootUrl ?? f.normalizedSourceRootUrl ?? key;
        group = { key, label: cleanRootLabel(rootUrl), rootUrl, sourceGroupId: f.sourceGroupId, files: [], status: 'none' };
        groupByKey.set(key, group);
        order.push(key);
      }
      group.files.push(f);
    } else {
      loose.push(f);
    }
  }

  const groups = order.map((k) => {
    const group = groupByKey.get(k) as SourceGroup;
    return { ...group, status: aggregateStatus(group.files) };
  });

  return { groups, loose };
}

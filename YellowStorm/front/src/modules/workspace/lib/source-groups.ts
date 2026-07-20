import type { IndexingStatus, WorkspaceFile } from '../types';

export interface SourceGroup {
  /** Normalized start URL — the grouping key. */
  key: string;
  /** Cleaned display label (host + path, no scheme). */
  label: string;
  /** Raw start URL, for the header tooltip. */
  rootUrl: string;
  files: WorkspaceFile[];
  /** Aggregate indexing status across the group's files. */
  status: IndexingStatus;
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
 * Partition workspace files into start-URL groups and loose files. A group is
 * formed only when 2+ url-documents share the same `normalizedSourceRootUrl`;
 * every other file (non-url, missing root, or a lone url-doc) stays loose.
 * First-seen order is preserved for both groups and loose files.
 */
export function groupBySourceRoot(files: WorkspaceFile[]): GroupedFiles {
  const counts = new Map<string, number>();
  for (const f of files) {
    if (f.type === 'url' && f.normalizedSourceRootUrl) {
      counts.set(f.normalizedSourceRootUrl, (counts.get(f.normalizedSourceRootUrl) ?? 0) + 1);
    }
  }

  const groupByKey = new Map<string, SourceGroup>();
  const order: string[] = [];
  const loose: WorkspaceFile[] = [];

  for (const f of files) {
    const key = f.type === 'url' ? f.normalizedSourceRootUrl : undefined;
    if (key && (counts.get(key) ?? 0) >= 2) {
      let group = groupByKey.get(key);
      if (!group) {
        group = { key, label: cleanRootLabel(f.sourceRootUrl ?? key), rootUrl: f.sourceRootUrl ?? key, files: [], status: 'none' };
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

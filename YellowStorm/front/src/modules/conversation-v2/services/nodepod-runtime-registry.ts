import type { Nodepod } from '@scelar/nodepod';
import type { NodepodPreviewStatus, NodepodRuntimeHealth, NodepodRuntimeSnapshot } from '../interfaces';

type NodepodInstance = Awaited<ReturnType<typeof Nodepod.boot>>;

export interface NodepodRuntimeEntry {
  runtimeKey: string;
  sessionId: string;
  revision: string;
  pod: NodepodInstance | null;
  podInstanceId: string | null;
  previewUrl: string | null;
  detectedPort: number | null;
  status: NodepodPreviewStatus;
  files: Record<string, string | Uint8Array> | null;
  createdAt: number;
  lastAccessedAt: number;
  lastHealthcheckAt: number | null;
  health: NodepodRuntimeHealth | null;
  bootPromise: Promise<NodepodRuntimeEntry> | null;
  error: string | null;
}

function cloneFiles(
  files: Record<string, string | Uint8Array> | null,
): Record<string, string | Uint8Array> | null {
  if (!files) return null;
  return { ...files };
}

function cloneHealth(health: NodepodRuntimeHealth | null): NodepodRuntimeHealth | null {
  if (!health) return null;
  return { ...health };
}

function cloneEntry(entry: NodepodRuntimeEntry): NodepodRuntimeEntry {
  return {
    ...entry,
    files: cloneFiles(entry.files),
    health: cloneHealth(entry.health),
  };
}

export function createRuntimeKey(sessionId: string, revision: string): string {
  return `${sessionId}:${revision}`;
}

/**
 * External-store friendly registry: `getSnapshot()` returns a referentially
 * stable object until the entry actually changes. Cloning on every read would
 * infinite-loop `useSyncExternalStore`.
 */
export class NodepodRuntimeRegistry {
  private readonly entries = new Map<string, NodepodRuntimeEntry>();
  private readonly snapshots = new Map<string, NodepodRuntimeSnapshot>();
  private readonly listeners = new Set<() => void>();

  private notify() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private cacheSnapshot(entry: NodepodRuntimeEntry): NodepodRuntimeSnapshot {
    const snapshot = this.toSnapshot(entry);
    this.snapshots.set(entry.runtimeKey, snapshot);
    return snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Stable for useSyncExternalStore — same reference until set/update/delete. */
  getSnapshot(runtimeKey: string): NodepodRuntimeSnapshot | null {
    return this.snapshots.get(runtimeKey) ?? null;
  }

  get(runtimeKey: string): NodepodRuntimeEntry | null {
    const entry = this.entries.get(runtimeKey);
    return entry ? cloneEntry(entry) : null;
  }

  getMutable(runtimeKey: string): NodepodRuntimeEntry | null {
    return this.entries.get(runtimeKey) ?? null;
  }

  set(entry: NodepodRuntimeEntry): NodepodRuntimeEntry {
    const stored = cloneEntry(entry);
    this.entries.set(entry.runtimeKey, stored);
    this.cacheSnapshot(stored);
    this.notify();
    return cloneEntry(stored);
  }

  update(
    runtimeKey: string,
    updater: (entry: NodepodRuntimeEntry) => NodepodRuntimeEntry,
  ): NodepodRuntimeEntry | null {
    const current = this.entries.get(runtimeKey);
    if (!current) return null;
    const next = cloneEntry(updater(cloneEntry(current)));
    this.entries.set(runtimeKey, next);
    this.cacheSnapshot(next);
    this.notify();
    return cloneEntry(next);
  }

  delete(runtimeKey: string): void {
    this.entries.delete(runtimeKey);
    this.snapshots.delete(runtimeKey);
    this.notify();
  }

  list(): NodepodRuntimeEntry[] {
    return Array.from(this.entries.values(), (entry) => cloneEntry(entry));
  }

  listBySession(sessionId: string): NodepodRuntimeEntry[] {
    return this.list().filter((entry) => entry.sessionId === sessionId);
  }

  /**
   * LRU touch — mutates in place and does NOT notify subscribers.
   * UI snapshots do not depend on lastAccessedAt for rendering.
   */
  touch(runtimeKey: string, at = Date.now()): NodepodRuntimeEntry | null {
    const current = this.entries.get(runtimeKey);
    if (!current) return null;
    current.lastAccessedAt = at;
    return current;
  }

  toSnapshot(entry: NodepodRuntimeEntry): NodepodRuntimeSnapshot {
    return {
      runtimeKey: entry.runtimeKey,
      sessionId: entry.sessionId,
      revision: entry.revision,
      status: entry.status,
      previewUrl: entry.previewUrl,
      detectedPort: entry.detectedPort,
      error: entry.error,
      files: cloneFiles(entry.files),
      podInstanceId: entry.podInstanceId,
      createdAt: entry.createdAt,
      lastAccessedAt: entry.lastAccessedAt,
      lastHealthcheckAt: entry.lastHealthcheckAt,
      health: cloneHealth(entry.health),
    };
  }
}

export const nodepodRuntimeRegistry = new NodepodRuntimeRegistry();

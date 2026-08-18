import type { DiffResult } from './runtime.types';

/** Path -> sha256 of the file content at a given revision. */
export type ShaManifest = Map<string, string>;

const REV_ID_RE = /^rev_(\d+)$/;

/**
 * Local, monotonic revision tracker mirroring `_WorkspaceFS` in the APImanus
 * stub adapter. Revisions are minted in the browser and are NOT durable — the
 * Ceph commit lands in Vague 5. Until then this is what lets mutating tools
 * return a real `revisionId`, which is the only thing that makes the backend
 * advance `latestRevisionId`.
 */
export class WorkspaceRevisionStore {
  private counter = 0;
  private revisions = new Map<string, ShaManifest>();
  private parents = new Map<string, string | null>();
  private _latestRevisionId = 'rev_0';

  constructor(initial?: ShaManifest) {
    if (initial) this.seed(initial);
  }

  get latestRevisionId(): string {
    return this._latestRevisionId;
  }

  /** Revision ids oldest-first. */
  get revisionIds(): string[] {
    return [...this.revisions.keys()];
  }

  private mintId(): string {
    this.counter += 1;
    return `rev_${this.counter}`;
  }

  /**
   * Reset history to a single root revision. Used at boot and after a
   * `runtime.rehydrate`, where `revisionId` is the id the backend expects us to
   * be at.
   */
  seed(manifest: ShaManifest, revisionId?: string): string {
    this.revisions.clear();
    this.parents.clear();

    let id: string;
    if (revisionId) {
      id = revisionId;
      const numbered = REV_ID_RE.exec(revisionId);
      // Keep minting strictly ahead of whatever the backend handed us.
      if (numbered) this.counter = Math.max(this.counter, Number(numbered[1]));
    } else {
      id = this.mintId();
    }

    this.revisions.set(id, new Map(manifest));
    this.parents.set(id, null);
    this._latestRevisionId = id;
    return id;
  }

  /** Record a new revision from the full current sha manifest. */
  commit(manifest: ShaManifest): string {
    const id = this.mintId();
    this.revisions.set(id, new Map(manifest));
    this.parents.set(id, this._latestRevisionId);
    this._latestRevisionId = id;
    return id;
  }

  has(revisionId: string): boolean {
    return this.revisions.has(revisionId);
  }

  snapshot(revisionId: string): ShaManifest | null {
    const found = this.revisions.get(revisionId);
    return found ? new Map(found) : null;
  }

  parentOf(revisionId: string): string | null {
    return this.parents.get(revisionId) ?? null;
  }

  /**
   * Compare the live sha manifest against a base revision, matching the
   * `diff` tool contract. When `revisionId` is omitted the base is the parent
   * of the latest revision; when it is unknown the result is empty (stub
   * parity — an unknown base is not an error).
   */
  diffAgainst(
    current: ShaManifest,
    revisionId?: string | null,
    path?: string | null,
  ): DiffResult {
    let base: ShaManifest;

    if (revisionId) {
      const found = this.revisions.get(revisionId);
      if (!found) {
        return {
          revisionId: this._latestRevisionId,
          parentRevisionId: null,
          diff: '',
          changedFiles: [],
        };
      }
      base = found;
    } else {
      const parentId = this.parentOf(this._latestRevisionId);
      base = (parentId && this.revisions.get(parentId)) || new Map();
    }

    const changedFiles: string[] = [];
    const diffLines: string[] = [];
    const allPaths = [...new Set([...base.keys(), ...current.keys()])].sort();

    for (const filePath of allPaths) {
      if (path && filePath !== path) continue;
      const oldHash = base.get(filePath);
      const newHash = current.get(filePath);
      if (oldHash === newHash) continue;

      changedFiles.push(filePath);
      if (newHash !== undefined) {
        diffLines.push(`--- a/${filePath}`);
        diffLines.push(`+++ b/${filePath}`);
        diffLines.push(`@@ SHA-256: ${oldHash ?? '(none)'} -> ${newHash} @@`);
      } else {
        diffLines.push(`- ${filePath} (deleted)`);
      }
    }

    return {
      revisionId: this._latestRevisionId,
      parentRevisionId: revisionId ?? null,
      diff: diffLines.length > 0 ? diffLines.join('\n') : '(no changes)',
      changedFiles,
    };
  }
}

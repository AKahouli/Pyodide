/**
 * Lookup port for revisions that App Runtime does not own.
 *
 * Template revisions are produced by Conversation V2. App Runtime only needs
 * to know whether a foreign revision id resolves and where its manifest lives,
 * so it depends on this port instead of importing Conversation V2 stores. The
 * adapter lives with the implementation that owns the data.
 */
export const SYSTEM_REVISION_SOURCE = Symbol('SYSTEM_REVISION_SOURCE');

export type SystemRevisionStatus = 'draft' | 'published';

export interface SystemRevisionResolution {
  status: SystemRevisionStatus;
  /** Manifest object key; null until the owning module publishes a manifest. */
  manifestObjectKey: string | null;
}

export interface SystemRevisionSource {
  /** Resolve a foreign revision id, or null when no module owns it. */
  findByRevisionId(revisionId: string): Promise<SystemRevisionResolution | null>;
  /** DB-first manifest metadata for a foreign revision, or null when absent. */
  findRevision(revisionId: string): Promise<SystemRevisionManifest | null>;
}

export interface SystemRevisionFile {
  path: string;
  sha256: string;
  objectKey: string;
  size: number;
}

export interface SystemRevisionManifest {
  revisionId: string;
  manifestHash: string;
  manifestObjectKey: string;
  files: SystemRevisionFile[];
}
export type MountMode = "r" | "rw";

export interface WorkspaceMount {
  virtualPath: string;
  cephPrefix: string;
  mode: MountMode;
  allowedRelativePaths?: string[];
}

export interface ExecutionContext {
  userId: string;
  runId: string;
  mounts: WorkspaceMount[];
}

export type FileSourceKind = "workspace" | "attachment" | "run";

export interface ResolvedFile {
  name: string;
  path: string;
  source: {
    kind: FileSourceKind;
    alias: string;
  };
  sizeBytes: number;
  modifiedAt?: string;
  contentType?: string;
}

export interface PublicFileRef {
  name: string;
  path: string;
  sizeBytes: number;
  contentType?: string;
  createdBy: "run_code";
}

export interface InternalFileRef extends PublicFileRef {
  objectKey: string;
}

export interface WorkspaceMutation {
  operation: "created" | "copied" | "removed";
  path: string;
  sizeBytes?: number;
  contentType?: string;
}

export interface FileStat {
  path: string;
  type: "file" | "directory";
  sizeBytes?: number;
  contentType?: string;
}

export interface WorkspaceEntry extends FileStat {
  name: string;
}

export interface ObjectStore {
  head(key: string, signal: AbortSignal): Promise<{
    sizeBytes: number;
    contentType?: string;
    modifiedAt?: string;
  } | null>;
  list(
    prefix: string,
    delimiter: string,
    maxKeys: number,
    signal: AbortSignal,
    continuationToken?: string
  ): Promise<{
    files: Array<{ key: string; sizeBytes: number; modifiedAt?: string; contentType?: string }>;
    prefixes: string[];
    truncated: boolean;
    nextContinuationToken?: string;
  }>;
  read(key: string, maxBytes: number, signal: AbortSignal): Promise<Uint8Array>;
  write(
    key: string,
    body: Uint8Array,
    contentType: string,
    signal: AbortSignal
  ): Promise<void>;
  copy(
    sourceKey: string,
    destinationKey: string,
    options: { overwrite: boolean },
    signal: AbortSignal
  ): Promise<{ sizeBytes: number; contentType?: string }>;
  delete(key: string, signal: AbortSignal): Promise<void>;
}

export interface WorkspaceHost {
  invoke(operation: string, args: unknown[], signal: AbortSignal): Promise<unknown>;
  readonly writtenFiles: PublicFileRef[];
  readonly mutations: WorkspaceMutation[];
}

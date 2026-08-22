export type MountMode = "r" | "rw";

export interface WorkspaceMount {
  virtualPath: string;
  cephPrefix: string;
  mode: MountMode;
}

export interface ExecutionContext {
  userId: string;
  runId: string;
  mounts: WorkspaceMount[];
}

export interface FileRef {
  name: string;
  virtualPath: string;
  objectKey: string;
  sizeBytes: number;
  contentType: string;
  createdBy: "run_code";
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
  head(key: string, signal: AbortSignal): Promise<{ sizeBytes: number; contentType?: string } | null>;
  list(
    prefix: string,
    delimiter: string,
    maxKeys: number,
    signal: AbortSignal
  ): Promise<{
    files: Array<{ key: string; sizeBytes: number }>;
    prefixes: string[];
    truncated: boolean;
  }>;
  read(key: string, maxBytes: number, signal: AbortSignal): Promise<Uint8Array>;
  write(
    key: string,
    body: Uint8Array,
    contentType: string,
    signal: AbortSignal
  ): Promise<void>;
}

export interface WorkspaceHost {
  invoke(operation: string, args: unknown[], signal: AbortSignal): Promise<unknown>;
  readonly writtenFiles: FileRef[];
}

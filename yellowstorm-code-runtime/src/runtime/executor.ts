import type { RuntimeLimits } from "./limits.js";
import type { FileRef, WorkspaceHost } from "../workspace/types.js";

export interface ExecuteInput {
  code: string;
  input?: unknown;
  host: WorkspaceHost;
  limits: RuntimeLimits;
}

export interface ExecutionResult {
  result: unknown;
  logs: string[];
  logsTruncated: boolean;
  writtenFiles: FileRef[];
  durationMs: number;
  runtime: "quickjs";
}

export interface Executor {
  execute(input: ExecuteInput): Promise<ExecutionResult>;
}

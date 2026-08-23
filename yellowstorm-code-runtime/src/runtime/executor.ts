import type { RuntimeLimits } from "./limits.js";
import type { PublicFileRef, WorkspaceHost, WorkspaceMutation } from "../workspace/types.js";

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
  writtenFiles: PublicFileRef[];
  mutations: WorkspaceMutation[];
  durationMs: number;
  runtime: "quickjs";
}

export interface Executor {
  execute(input: ExecuteInput): Promise<ExecutionResult>;
}

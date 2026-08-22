export const ERROR_CODES = [
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "INVALID_CODE",
  "CODE_TOO_LARGE",
  "INPUT_TOO_LARGE",
  "EXECUTION_TIMEOUT",
  "MEMORY_LIMIT",
  "RUNTIME_ERROR",
  "INVALID_OUTPUT",
  "RESULT_TOO_LARGE",
  "HOST_OPERATION_LIMIT",
  "HOST_CONCURRENCY_LIMIT",
  "INVALID_PATH",
  "PATH_NOT_MOUNTED",
  "READ_ONLY_MOUNT",
  "FILE_NOT_FOUND",
  "FILE_TOO_LARGE",
  "LIST_TOO_LARGE",
  "INVALID_UTF8",
  "INVALID_JSON",
  "WRITE_TOO_LARGE",
  "TOTAL_READ_LIMIT",
  "TOTAL_WRITE_LIMIT",
  "CEPH_UNAVAILABLE",
  "SERVICE_BUSY"
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const HEAVY_CAPABILITY_CODES = new Set<ErrorCode>([
  "CODE_TOO_LARGE",
  "INPUT_TOO_LARGE",
  "EXECUTION_TIMEOUT",
  "MEMORY_LIMIT",
  "RESULT_TOO_LARGE",
  "FILE_TOO_LARGE",
  "LIST_TOO_LARGE",
  "WRITE_TOO_LARGE",
  "TOTAL_READ_LIMIT",
  "TOTAL_WRITE_LIMIT",
  "HOST_OPERATION_LIMIT",
  "HOST_CONCURRENCY_LIMIT"
]);

export class RuntimeError extends Error {
  readonly recommendedCapability?: "mcp-manus";

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly statusCode = 400
  ) {
    super(message);
    this.name = "RuntimeError";
    if (HEAVY_CAPABILITY_CODES.has(code)) {
      this.recommendedCapability = "mcp-manus";
    }
  }
}

export function asRuntimeError(error: unknown): RuntimeError {
  if (error instanceof RuntimeError) return error;
  const message = error instanceof Error ? error.message : "Execution failed.";
  return new RuntimeError("RUNTIME_ERROR", message);
}

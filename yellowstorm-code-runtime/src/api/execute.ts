import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServiceConfig } from "../config.js";
import { RuntimeError, asRuntimeError } from "../runtime/errors.js";
import type { Executor } from "../runtime/executor.js";
import type { Metrics } from "../telemetry/metrics.js";
import type { ExecutionContext, ObjectStore } from "../workspace/types.js";
import { WorkspaceFS } from "../workspace/workspace-fs.js";

interface ExecuteRequest {
  code: string;
  input?: unknown;
  context: ExecutionContext;
}

class ExecutionGate {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly maximum: number,
    private readonly queueMaximum: number,
    private readonly metrics: Metrics
  ) {}

  async enter(): Promise<() => void> {
    if (this.active >= this.maximum) {
      if (this.waiters.length >= this.queueMaximum) throw new RuntimeError("SERVICE_BUSY", "Code runtime is busy.", 503);
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        this.metrics.setQueueDepth(this.waiters.length);
      });
    } else {
      this.active += 1;
      this.metrics.setActive(this.active);
    }
    return () => {
      const next = this.waiters.shift();
      this.metrics.setQueueDepth(this.waiters.length);
      if (next) {
        next();
      } else {
        this.active -= 1;
        this.metrics.setActive(this.active);
      }
    };
  }
}

export function createExecuteHandler(
  config: ServiceConfig,
  executor: Executor,
  store: ObjectStore,
  metrics: Metrics
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const gate = new ExecutionGate(config.maxConcurrentExecutions, config.maxQueueDepth, metrics);
  return async (request, response) => {
    metrics.request();
    let workspace: WorkspaceFS | undefined;
    let leave: (() => void) | undefined;
    try {
      authenticate(request.headers.authorization, config.apiKey);
      const payload = validateRequest(await readJsonBody(request, config.maxHttpBodyBytes));
      workspace = new WorkspaceFS(payload.context, store, config.limits);
      leave = await gate.enter();
      const result = await executor.execute({
        code: payload.code,
        ...(Object.hasOwn(payload, "input") ? { input: payload.input } : {}),
        host: workspace,
        limits: config.limits
      });
      metrics.success();
      sendJson(response, 200, {
        ok: true,
        result: result.result,
        logs: result.logs,
        writtenFiles: result.writtenFiles,
        mutations: result.mutations,
        execution: { durationMs: result.durationMs, runtime: result.runtime }
      });
    } catch (error) {
      const runtimeError = asRuntimeError(error);
      metrics.failure(runtimeError.code);
      sendJson(response, runtimeError.statusCode, {
        ok: false,
        error: {
          code: runtimeError.code,
          message: runtimeError.message,
          ...(runtimeError.recommendedCapability ? { recommendedCapability: runtimeError.recommendedCapability } : {})
        },
        logs: [],
        writtenFiles: workspace ? [...workspace.writtenFiles] : [],
        mutations: workspace ? [...workspace.mutations] : [],
        execution: { durationMs: 0, runtime: "quickjs" }
      });
    } finally {
      leave?.();
    }
  };
}

function authenticate(header: string | undefined, expected: string): void {
  const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const left = createHash("sha256").update(supplied).digest();
  const right = createHash("sha256").update(expected).digest();
  if (!supplied || !timingSafeEqual(left, right)) throw new RuntimeError("UNAUTHORIZED", "Unauthorized.", 401);
}

async function readJsonBody(request: IncomingMessage, maximum: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.byteLength;
    if (size > maximum) throw new RuntimeError("INVALID_REQUEST", "Request body is too large.", 413);
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RuntimeError("INVALID_REQUEST", "Request body must be valid JSON.");
  }
}

function validateRequest(value: unknown): ExecuteRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RuntimeError("INVALID_REQUEST", "Invalid execution request.");
  const request = value as Record<string, unknown>;
  const allowed = new Set(["code", "input", "context"]);
  if (Object.keys(request).some((key) => !allowed.has(key))) throw new RuntimeError("INVALID_REQUEST", "Execution request contains unknown fields.");
  if (typeof request.code !== "string" || !request.context || typeof request.context !== "object" || Array.isArray(request.context)) {
    throw new RuntimeError("INVALID_REQUEST", "Execution request is missing code or context.");
  }
  const context = request.context as Record<string, unknown>;
  if (typeof context.userId !== "string" || typeof context.runId !== "string" || !Array.isArray(context.mounts)) {
    throw new RuntimeError("INVALID_REQUEST", "Invalid execution context.");
  }
  const mounts = context.mounts.map((mount) => {
    if (!mount || typeof mount !== "object" || Array.isArray(mount)) throw new RuntimeError("INVALID_REQUEST", "Invalid workspace mount.");
    const item = mount as Record<string, unknown>;
    if (typeof item.virtualPath !== "string" || typeof item.cephPrefix !== "string" || (item.mode !== "r" && item.mode !== "rw")) {
      throw new RuntimeError("INVALID_REQUEST", "Invalid workspace mount.");
    }
    if (item.allowedRelativePaths !== undefined && (!Array.isArray(item.allowedRelativePaths) || item.allowedRelativePaths.some((path) => typeof path !== "string"))) {
      throw new RuntimeError("INVALID_REQUEST", "Invalid workspace file scope.");
    }
    return {
      virtualPath: item.virtualPath,
      cephPrefix: item.cephPrefix,
      mode: item.mode as "r" | "rw",
      ...(Array.isArray(item.allowedRelativePaths) ? { allowedRelativePaths: item.allowedRelativePaths as string[] } : {})
    };
  });
  return {
    code: request.code,
    ...(Object.hasOwn(request, "input") ? { input: request.input } : {}),
    context: { userId: context.userId, runId: context.runId, mounts }
  };
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(serialized),
    "cache-control": "no-store"
  });
  response.end(serialized);
}

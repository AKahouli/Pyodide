import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  MUTATING_TOOLS,
  TOOL_REQUIRED_CAPABILITY,
} from '../constants/app-runtime-capabilities';
import { AppRuntimeErrorCodes } from '../constants/app-runtime-error-codes';
import {
  RUNTIME_TOOL_CALL_STORE,
  type RuntimeToolCallStore,
} from '../persistence/runtime-tool-call.store';
import {
  AppRuntimeEvents,
  RuntimeToolError,
  ToolCompletedPayload,
  ToolFailedPayload,
  ToolInvokeEnvelope,
  ToolProgressPayload,
} from '../types/app-runtime-protocol';
import { RuntimeBindingService } from './runtime-binding.service';
import {
  RuntimeConnection,
  RuntimeConnectionRegistry,
} from './runtime-connection.registry';
import { RuntimeRevisionService } from './runtime-revision.service';

export interface InvokeToolParams {
  workspaceId: string;
  toolCallId: string;
  tool: string;
  arguments?: Record<string, unknown>;
  baseRevisionId?: string;
  timeoutMs?: number;
}

type ToolOutcome =
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; error: RuntimeToolError };

interface PendingCall {
  workspaceId: string;
  settle: (outcome: ToolOutcome) => void;
  rearmTimeout: () => void;
}

function runtimeError(
  code: number,
  message: string,
  data?: Record<string, unknown>,
): RuntimeToolError {
  return data ? { code, message, data } : { code, message };
}

function failure(toolCallId: string, error: RuntimeToolError): ToolInvokeEnvelope {
  return { ok: false, toolCallId, error };
}

/**
 * Dispatches a Runtime MCP tool call to the browser runtime over Socket.IO and
 * waits for its outcome, so the APImanus broker can keep treating the call as
 * a plain request/response.
 */
@Injectable()
export class RuntimeToolDispatcherService {
  private readonly logger = new Logger(RuntimeToolDispatcherService.name);
  private readonly pending = new Map<string, PendingCall>();
  /** In-process coalescing so a retry never starts a second dispatch. */
  private readonly inFlight = new Map<string, Promise<ToolInvokeEnvelope>>();

  constructor(
    @Inject(RUNTIME_TOOL_CALL_STORE)
    private readonly toolCalls: RuntimeToolCallStore,
    private readonly bindings: RuntimeBindingService,
    private readonly registry: RuntimeConnectionRegistry,
    private readonly revisions: RuntimeRevisionService,
    private readonly config: ConfigService,
  ) {}

  async invoke(params: InvokeToolParams): Promise<ToolInvokeEnvelope> {
    const existing = this.inFlight.get(params.toolCallId);
    if (existing) {
      this.logger.debug(
        `Attaching to in-flight tool call toolCallId=${params.toolCallId}`,
      );
      return existing;
    }

    const flight = this.invokeOwned(params).finally(() => {
      if (this.inFlight.get(params.toolCallId) === flight) {
        this.inFlight.delete(params.toolCallId);
      }
    });
    this.inFlight.set(params.toolCallId, flight);
    return flight;
  }

  private async invokeOwned(params: InvokeToolParams): Promise<ToolInvokeEnvelope> {
    const { workspaceId, toolCallId, tool } = params;
    const args = params.arguments ?? {};

    const replay = await this.replayIfSettled(toolCallId, params.timeoutMs);
    if (replay) return replay;

    const binding = await this.bindings.findByWorkspaceId(workspaceId);
    if (!binding) {
      return failure(
        toolCallId,
        runtimeError(
          AppRuntimeErrorCodes.RUNTIME_OFFLINE,
          `No runtime binding for workspace ${workspaceId}`,
          { workspaceId },
        ),
      );
    }

    const connection = this.registry.get(workspaceId);
    if (!connection) {
      await this.bindings.markWaitingForBrowser(workspaceId);
      return failure(
        toolCallId,
        runtimeError(
          AppRuntimeErrorCodes.RUNTIME_OFFLINE,
          'No browser runtime is connected for this workspace',
          { bindingId: binding.bindingId },
        ),
      );
    }

    if (this.registry.isStale(connection)) {
      await this.bindings.markWaitingForBrowser(workspaceId);
      return failure(
        toolCallId,
        runtimeError(
          AppRuntimeErrorCodes.RUNTIME_OFFLINE,
          'Browser runtime heartbeat timed out',
          { bindingId: binding.bindingId },
        ),
      );
    }

    const requiredCapability = TOOL_REQUIRED_CAPABILITY[tool];
    if (requiredCapability && !connection.capabilities[requiredCapability]) {
      return failure(
        toolCallId,
        runtimeError(
          AppRuntimeErrorCodes.UNSUPPORTED_CAPABILITY,
          `Browser runtime cannot run "${tool}": missing capability "${requiredCapability}"`,
          { requiredCapability, fallbackAvailable: false },
        ),
      );
    }

    await this.recordRunning(params, binding.bindingId, args);

    const isMutating = MUTATING_TOOLS.has(tool);
    const execute = () => this.executeGuarded(params, args, isMutating);

    if (!isMutating) return execute();

    return this.registry.withMutationLock(
      workspaceId,
      () =>
        failure(
          toolCallId,
          runtimeError(
            AppRuntimeErrorCodes.TOOL_TIMEOUT,
            'Timed out waiting for the workspace mutation lock',
            { tool, timeoutMs: this.mutationWaitMs() },
          ),
        ),
      execute,
    );
  }

  /**
   * Runs inside the mutation lock, so the revision guard sees the state left
   * by any mutation queued ahead of this one.
   */
  private async executeGuarded(
    params: InvokeToolParams,
    args: Record<string, unknown>,
    isMutating: boolean,
  ): Promise<ToolInvokeEnvelope> {
    const { workspaceId, toolCallId } = params;

    const connection = this.registry.get(workspaceId);
    if (!connection) {
      return this.settleFailure(
        toolCallId,
        runtimeError(
          AppRuntimeErrorCodes.RUNTIME_OFFLINE,
          'Browser runtime disconnected before dispatch',
          { workspaceId },
        ),
      );
    }

    const binding = await this.bindings.findByWorkspaceId(workspaceId);
    const expectedRevisionId =
      binding?.latestRevisionId ?? params.baseRevisionId ?? 'rev_0';

    if (isMutating && connection.revisionId !== expectedRevisionId) {
      const revisionPersisted = await this.revisions.revisionExists(
        workspaceId,
        expectedRevisionId,
      );
      if (revisionPersisted) {
        connection.socket.emit(AppRuntimeEvents.REHYDRATE, {
          workspaceId,
          expectedRevisionId,
          actualRevisionId: connection.revisionId,
        });
        this.logger.warn(
          `Stale browser filesystem workspaceId=${workspaceId} expected=${expectedRevisionId} actual=${connection.revisionId}`,
        );
        return this.settleFailure(
          toolCallId,
          runtimeError(
            AppRuntimeErrorCodes.REVISION_CONFLICT,
            'Browser filesystem is behind the workspace revision; rehydration requested',
            { expectedRevisionId, actualRevisionId: connection.revisionId },
          ),
        );
      }

      this.logger.warn(
        `Revision ${expectedRevisionId} not persisted for workspaceId=${workspaceId}; browser at ${connection.revisionId}`,
      );
      return this.settleFailure(
        toolCallId,
        runtimeError(
          AppRuntimeErrorCodes.REVISION_CONFLICT,
          'Workspace revision is not yet available in Ceph; retry the mutation',
          { expectedRevisionId, actualRevisionId: connection.revisionId },
        ),
      );
    }

    const outcome = await this.dispatchToBrowser(
      connection,
      params,
      args,
      expectedRevisionId,
    );

    if (!outcome.ok) return this.settleFailure(toolCallId, outcome.error);

    const revisionId =
      isMutating && typeof outcome.result.revisionId === 'string'
        ? outcome.result.revisionId
        : undefined;

    if (revisionId) {
      await this.bindings.updateRevision(workspaceId, revisionId);
      this.registry.setRevision(workspaceId, revisionId);
    }

    await this.toolCalls.markSucceeded(
      toolCallId,
      outcome.result,
      revisionId ?? null,
      await this.elapsedMs(toolCallId),
    );

    return { ok: true, toolCallId, result: outcome.result, revisionId };
  }

  private dispatchToBrowser(
    connection: RuntimeConnection,
    params: InvokeToolParams,
    args: Record<string, unknown>,
    baseRevisionId: string,
  ): Promise<ToolOutcome> {
    const { toolCallId, workspaceId, tool } = params;
    const timeoutMs =
      params.timeoutMs ??
      this.config.get<number>('appRuntime.toolTimeoutMs', 180_000);

    return new Promise<ToolOutcome>((resolve) => {
      let timer: NodeJS.Timeout;

      const settle = (outcome: ToolOutcome): void => {
        clearTimeout(timer);
        this.pending.delete(toolCallId);
        resolve(outcome);
      };

      const rearmTimeout = (): void => {
        clearTimeout(timer);
        timer = setTimeout(onTimeout, timeoutMs);
      };

      const onTimeout = (): void =>
        settle({
          ok: false,
          error: runtimeError(
            AppRuntimeErrorCodes.TOOL_TIMEOUT,
            `Browser runtime did not answer "${tool}" in time`,
            { tool, timeoutMs },
          ),
        });

      timer = setTimeout(onTimeout, timeoutMs);
      this.pending.set(toolCallId, { workspaceId, settle, rearmTimeout });

      connection.socket.emit(AppRuntimeEvents.TOOL_INVOKE, {
        toolCallId,
        workspaceId,
        tool,
        arguments: args,
        baseRevisionId,
        timeoutMs,
      });
    });
  }

  /** Progress is only used to keep a long-running tool from hitting the timeout. */
  handleProgress(workspaceId: string, payload: ToolProgressPayload): void {
    const pending = this.pending.get(payload?.toolCallId);
    if (!pending || pending.workspaceId !== workspaceId) return;
    pending.rearmTimeout();
  }

  handleCompleted(workspaceId: string, payload: ToolCompletedPayload): void {
    const pending = this.pending.get(payload?.toolCallId);
    if (!pending || pending.workspaceId !== workspaceId) return;
    pending.settle({ ok: true, result: payload.result ?? {} });
  }

  handleFailed(workspaceId: string, payload: ToolFailedPayload): void {
    const pending = this.pending.get(payload?.toolCallId);
    if (!pending || pending.workspaceId !== workspaceId) return;
    pending.settle({
      ok: false,
      error: {
        code: payload.error?.code ?? AppRuntimeErrorCodes.INTERNAL_ERROR,
        message: payload.error?.message ?? 'Browser runtime tool failed',
        data: payload.error?.data,
      },
    });
  }

  /** Called on disconnect so in-flight calls fail fast instead of timing out. */
  failPendingForWorkspace(workspaceId: string, message: string): void {
    for (const [toolCallId, pending] of this.pending) {
      if (pending.workspaceId !== workspaceId) continue;
      this.pending.delete(toolCallId);
      pending.settle({
        ok: false,
        error: runtimeError(AppRuntimeErrorCodes.RUNTIME_OFFLINE, message, {
          workspaceId,
        }),
      });
    }
  }

  private async replayIfSettled(
    toolCallId: string,
    timeoutMs?: number,
  ): Promise<ToolInvokeEnvelope | null> {
    const existing = await this.toolCalls.findByToolCallId(toolCallId);
    if (!existing) return null;

    const terminal = this.envelopeFromTerminal(toolCallId, existing);
    if (terminal) return terminal;

    if (existing.status === 'pending' || existing.status === 'running') {
      this.logger.debug(
        `Waiting for in-flight tool call toolCallId=${toolCallId} status=${existing.status}`,
      );
      return this.waitForTerminalRecord(toolCallId, timeoutMs);
    }

    return null;
  }

  private envelopeFromTerminal(
    toolCallId: string,
    existing: {
      status?: string;
      result?: Record<string, unknown> | null;
      resultingRevisionId?: string | null;
      error?: Record<string, unknown> | null;
    },
  ): ToolInvokeEnvelope | null {
    if (existing.status === 'succeeded') {
      this.logger.debug(`Replaying settled tool call toolCallId=${toolCallId}`);
      return {
        ok: true,
        toolCallId,
        result: existing.result ?? {},
        revisionId: existing.resultingRevisionId ?? undefined,
      };
    }

    if (existing.status === 'failed') {
      return failure(
        toolCallId,
        (existing.error as unknown as RuntimeToolError) ??
          runtimeError(AppRuntimeErrorCodes.INTERNAL_ERROR, 'Tool call failed'),
      );
    }

    return null;
  }

  /**
   * A pending/running record must not start a second browser dispatch. Wait
   * until the owner persists a terminal status, then replay that outcome.
   */
  private async waitForTerminalRecord(
    toolCallId: string,
    timeoutMs?: number,
  ): Promise<ToolInvokeEnvelope> {
    const waitMs =
      timeoutMs ?? this.config.get<number>('appRuntime.toolTimeoutMs', 180_000);
    const deadline = Date.now() + waitMs;

    while (true) {
      const existing = await this.toolCalls.findByToolCallId(toolCallId);
      const terminal = existing
        ? this.envelopeFromTerminal(toolCallId, existing)
        : null;
      if (terminal) return terminal;

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return failure(
          toolCallId,
          runtimeError(
            AppRuntimeErrorCodes.TOOL_TIMEOUT,
            'Timed out waiting for an in-flight tool call with the same toolCallId',
            { toolCallId, timeoutMs: waitMs },
          ),
        );
      }

      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(50, remaining)),
      );
    }
  }

  private async recordRunning(
    params: InvokeToolParams,
    bindingId: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    await this.toolCalls.upsertRunning({
      toolCallId: params.toolCallId,
      bindingId,
      workspaceId: params.workspaceId,
      tool: params.tool,
      argumentsHash: createHash('sha256')
        .update(JSON.stringify(args))
        .digest('hex'),
      baseRevisionId: params.baseRevisionId ?? null,
    });
  }

  private async elapsedMs(toolCallId: string): Promise<number | null> {
    const startedAtMs = await this.toolCalls.getStartedAtMs(toolCallId);
    if (typeof startedAtMs !== 'number') return null;
    return Math.max(0, Date.now() - startedAtMs);
  }

  private async settleFailure(
    toolCallId: string,
    error: RuntimeToolError,
  ): Promise<ToolInvokeEnvelope> {
    await this.toolCalls.markFailed(
      toolCallId,
      error as unknown as Record<string, unknown>,
      await this.elapsedMs(toolCallId),
    );
    return failure(toolCallId, error);
  }

  private mutationWaitMs(): number {
    return this.config.get<number>('appRuntime.mutationWaitMs', 30_000);
  }
}

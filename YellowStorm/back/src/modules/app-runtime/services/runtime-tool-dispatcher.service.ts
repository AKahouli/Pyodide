import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model } from 'mongoose';
import {
  MUTATING_TOOLS,
  TOOL_REQUIRED_CAPABILITY,
} from '../constants/app-runtime-capabilities';
import { AppRuntimeErrorCodes } from '../constants/app-runtime-error-codes';
import {
  AppRuntimeToolCall,
  AppRuntimeToolCallDocument,
} from '../schemas/app-runtime-tool-call.schema';
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

  constructor(
    @InjectModel(AppRuntimeToolCall.name)
    private readonly toolCalls: Model<AppRuntimeToolCallDocument>,
    private readonly bindings: RuntimeBindingService,
    private readonly registry: RuntimeConnectionRegistry,
    private readonly config: ConfigService,
  ) {}

  async invoke(params: InvokeToolParams): Promise<ToolInvokeEnvelope> {
    const { workspaceId, toolCallId, tool } = params;
    const args = params.arguments ?? {};

    const replay = await this.replayIfSettled(toolCallId);
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
      // No microVM fallback here: escalation is phase 5.
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
      params.baseRevisionId ?? binding?.latestRevisionId ?? 'rev_0';

    if (isMutating && connection.revisionId !== expectedRevisionId) {
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
      // Same rule as the APImanus broker: only mutating tools advance the
      // binding revision, and the browser is already at that revision.
      await this.bindings.updateRevision(workspaceId, revisionId);
      this.registry.setRevision(workspaceId, revisionId);
    }

    await this.toolCalls
      .updateOne(
        { toolCallId },
        {
          $set: {
            status: 'succeeded',
            result: outcome.result,
            error: null,
            resultingRevisionId: revisionId ?? null,
          },
        },
      )
      .exec();

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
    // Codes raised by the browser (UNSUPPORTED_CAPABILITY for a native binary,
    // PROCESS_FAILED, ...) are relayed untouched.
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
  ): Promise<ToolInvokeEnvelope | null> {
    const existing = await this.toolCalls.findOne({ toolCallId }).lean().exec();
    if (!existing) return null;

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

  private async recordRunning(
    params: InvokeToolParams,
    bindingId: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    await this.toolCalls
      .updateOne(
        { toolCallId: params.toolCallId },
        {
          $set: {
            bindingId,
            workspaceId: params.workspaceId,
            tool: params.tool,
            argumentsHash: createHash('sha256')
              .update(JSON.stringify(args))
              .digest('hex'),
            baseRevisionId: params.baseRevisionId ?? null,
            status: 'running',
          },
        },
        { upsert: true },
      )
      .exec();
  }

  private async settleFailure(
    toolCallId: string,
    error: RuntimeToolError,
  ): Promise<ToolInvokeEnvelope> {
    await this.toolCalls
      .updateOne({ toolCallId }, { $set: { status: 'failed', error } })
      .exec();
    return failure(toolCallId, error);
  }

  private mutationWaitMs(): number {
    return this.config.get<number>('appRuntime.mutationWaitMs', 30_000);
  }
}

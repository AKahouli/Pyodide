import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import {
  InvalidParamsError,
  InvalidToolNameError,
  JsonRpcErrorCode,
  McpError,
} from '../mcp/runtime-mcp.errors';
import {
  prepareFinalizeDispatchArgs,
  prepareToolArguments,
  type VerificationEvidence,
} from '../mcp/runtime-mcp-validation';
import {
  MUTATING_BROKER_TOOLS,
  TOOL_NAME_SET,
  type RuntimeMcpToolName,
} from '../mcp/runtime-mcp.tools';
import type { RuntimeBindingRecord as AppRuntimeBinding } from '../persistence/runtime-binding.store';
import { RuntimeToolDispatcherService } from './runtime-tool-dispatcher.service';
import { AppRuntimeConversationNotifierService } from './app-runtime-conversation-notifier.service';
import { AppDataReleaseBindingService } from '@modules/app-data/services/app-data-release-binding.service';
import type { ToolInvokeEnvelope } from '../types/app-runtime-protocol';

export interface BrokerDispatchResult {
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * YellowStorm Runtime Broker — validates MCP tool calls and dispatches them
 * directly to {@link RuntimeToolDispatcherService} (no HTTP tool-invoke hop).
 */
@Injectable()
export class RuntimeBrokerService {
  private readonly logger = new Logger(RuntimeBrokerService.name);

  constructor(
    private readonly dispatcher: RuntimeToolDispatcherService,
    private readonly config: ConfigService,
    private readonly conversationNotifier: AppRuntimeConversationNotifierService,
    @Optional() private readonly releaseBinding?: AppDataReleaseBindingService,
  ) {}

  async dispatch(
    toolName: string,
    argumentsRaw: Record<string, unknown>,
    binding: AppRuntimeBinding,
    toolCallId: string,
  ): Promise<BrokerDispatchResult> {
    if (!TOOL_NAME_SET.has(toolName)) {
      throw new InvalidToolNameError(toolName);
    }

    const tool = toolName as RuntimeMcpToolName;
    let args = prepareToolArguments(tool, argumentsRaw);

    if (tool === 'finalize') {
      const verification = args.verification as VerificationEvidence;
      const revisionId = prepareFinalizeDispatchArgs(args, binding.latestRevisionId).revisionId as string;
      if (!(verification.build ?? '').trim()) {
        this.logger.warn(
          `finalize rejected: missing build verification bindingId=${binding.bindingId} toolCallId=${toolCallId}`,
        );
        throw new McpError(
          JsonRpcErrorCode.INVALID_PARAMS,
          'finalize requires verification.build as a string (e.g. "npm run build exit 0"), not an object',
          { revisionId },
        );
      }
      args = prepareFinalizeDispatchArgs(args, binding.latestRevisionId);
    }

    const timeoutMs = this.resolveTimeout(tool, args);

    const envelope = await this.dispatcher.invoke({
      workspaceId: binding.workspaceId,
      toolCallId,
      tool,
      arguments: args,
      baseRevisionId: binding.latestRevisionId,
      timeoutMs,
    });

    const outcome = this.mapEnvelope(tool, envelope, binding, toolCallId);
    if (tool === 'finalize' && outcome.result && !outcome.error) {
      void this.conversationNotifier
        .notifyFinalize(binding, args, outcome.result)
        .catch((err: Error) => {
          this.logger.warn(
            `application_component push failed bindingId=${binding.bindingId}: ${err.message}`,
          );
        });
      if (this.releaseBinding && typeof outcome.result.revisionId === 'string') {
        void this.releaseBinding
          .bindRevision({
            workspaceId: binding.workspaceId,
            revisionId: outcome.result.revisionId as string,
          })
          .catch((err: Error) => {
            this.logger.warn(
              `release binding failed bindingId=${binding.bindingId}: ${err.message}`,
            );
          });
      }
    }
    return outcome;
  }

  private mapEnvelope(
    tool: RuntimeMcpToolName,
    envelope: ToolInvokeEnvelope,
    binding: AppRuntimeBinding,
    toolCallId: string,
  ): BrokerDispatchResult {
    if (!envelope.ok) {
      return {
        error: {
          code: envelope.error?.code ?? JsonRpcErrorCode.INTERNAL_ERROR,
          message: envelope.error?.message ?? 'Tool call failed',
          data: envelope.error?.data,
        },
      };
    }

    const result = envelope.result ?? {};

    if (tool === 'finalize') {
      const preview = result.preview as { healthy?: boolean } | undefined;
      if (!preview || preview.healthy !== true) {
        this.logger.warn(
          `finalize rejected: unhealthy preview bindingId=${binding.bindingId} toolCallId=${toolCallId}`,
        );
        throw new McpError(
          JsonRpcErrorCode.INVALID_PARAMS,
          'finalize requires a healthy preview inspection on the browser runtime',
          { revisionId: result.revisionId, preview },
        );
      }
      this.logger.log(
        `finalize ok bindingId=${binding.bindingId} toolCallId=${toolCallId} revisionId=${result.revisionId}`,
      );
    }

    // Keep the in-memory binding ahead for any caller that reuses the same
    // document in-process. Persistence is owned by the tool dispatcher.
    if (
      MUTATING_BROKER_TOOLS.has(tool) &&
      typeof result.revisionId === 'string' &&
      result.revisionId
    ) {
      binding.latestRevisionId = result.revisionId;
    }

    return { result };
  }

  private resolveTimeout(tool: RuntimeMcpToolName, args: Record<string, unknown>): number | undefined {
    if (tool === 'run' && typeof args.timeoutMs === 'number') {
      return args.timeoutMs;
    }
    return this.config.get<number>('appRuntime.toolTimeoutMs', 180_000);
  }

  /** Stable id when OpenCode omits toolCallId in params. */
  static newToolCallId(): string {
    return `tc_${randomBytes(6).toString('hex')}`;
  }
}

import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { LoggerService } from '@modules/logger';
import { UsageService } from '@modules/usage';
import type { MessageComponent, MessageReplayContext, ReliabilityEvaluation } from '../interfaces/message.interface';
import { MessageService } from './message.service';
import { StreamService, type ConversationHistoryEntry } from './stream.service';
import { CorrectiveReplayPromptBuilder, CORRECTIVE_REPLAY_PROMPT_VERSION } from './corrective-replay-prompt.builder';

const INTERNAL_COMPONENT_TYPES = new Set(['reasoning', 'chainOfThought', 'queue', 'checkpoint', 'toolInfo']);

export interface CorrectiveReplayResult {
  components: MessageComponent[];
  evidenceComponents: MessageComponent[];
  usage: { inputTokens: number; outputTokens: number; model?: string; durationMs: number };
  promptVersion: string;
}

export class CorrectiveReplayFailure extends Error {
  constructor(readonly code: string, readonly replayStarted: boolean) { super(code); }
}

@Injectable()
export class CorrectiveReplayRunnerService {
  constructor(
    @Inject(forwardRef(() => StreamService)) private readonly streamService: StreamService,
    private readonly messageService: MessageService,
    private readonly promptBuilder: CorrectiveReplayPromptBuilder,
    private readonly usageService: UsageService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(CorrectiveReplayRunnerService.name);
  }

  async run(input: {
    userId: string;
    username?: string;
    conversationId: string;
    messageId: string;
    questionMessageId: string;
    request: MessageReplayContext;
    originalComponents: MessageComponent[];
    evaluation: ReliabilityEvaluation;
    attemptNumber: number;
    timeoutMs: number;
  }): Promise<CorrectiveReplayResult> {
    const runnerStartedAt = Date.now();
    const replayRequestId = randomUUID();
    const sessionId = `correction:${input.conversationId}:${input.messageId}:${input.attemptNumber}:${replayRequestId}`;
    const idempotencyKey = `correction-replay:${replayRequestId}`;
    const originalAnswer = this.visibleText(input.originalComponents);
    const prompt = this.promptBuilder.build({
      originalQuestion: input.request.content,
      originalAnswer,
      evaluation: input.evaluation,
      attemptNumber: input.attemptNumber,
    });
    const history = await this.historyBefore(input.conversationId, input.questionMessageId);
    let seeded = false;
    let replayStarted = false;

    try {
      try {
        await this.streamService.seedConversationSession(input.userId, sessionId, idempotencyKey, history);
        seeded = true;
      } catch (error) {
        throw new CorrectiveReplayFailure('corrective_replay_session_seed_failed', false);
      }

      let built;
      try {
        built = await this.streamService.buildAgentExecutionRequest(
          input.userId,
          input.conversationId,
          { ...input.request, content: prompt.userQuery },
          input.username,
          prompt.correctionContext,
          { requestId: replayRequestId },
          sessionId,
          replayRequestId,
        );
      } catch (error) {
        throw new CorrectiveReplayFailure('corrective_replay_request_build_failed', false);
      }

      const execution = this.streamService.executePrivateAgentRequest(built, input.timeoutMs, input.username);
      try {
        await execution.started;
      } catch (error) {
        void execution.result.catch(() => undefined);
        throw error;
      }
      replayStarted = true;
      const result = await execution.result;
      const components = result.components.filter((component) => !INTERNAL_COMPONENT_TYPES.has(component.type));
      if (!this.visibleText(components)) throw new CorrectiveReplayFailure('corrective_replay_empty_response', true);

      await this.recordReplayUsage(input, result.usage, true);
      return {
        components,
        evidenceComponents: result.components,
        usage: result.usage,
        promptVersion: CORRECTIVE_REPLAY_PROMPT_VERSION,
      };
    } catch (error) {
      const failure = error instanceof CorrectiveReplayFailure
        ? error
        : new CorrectiveReplayFailure(
          error instanceof Error && error.message === 'corrective_replay_timeout'
            ? 'corrective_replay_timeout'
            : 'corrective_replay_grpc_unavailable',
          replayStarted,
        );
      await this.recordReplayUsage(input, {
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Date.now() - runnerStartedAt,
      }, false, failure.code);
      throw failure;
    } finally {
      if (seeded) await this.cleanupSession(input.userId, sessionId, idempotencyKey, input.messageId, replayRequestId);
    }
  }

  private async recordReplayUsage(
    input: { userId: string; conversationId: string; messageId: string; attemptNumber: number },
    usage: { inputTokens: number; outputTokens: number; model?: string; durationMs: number },
    success: boolean,
    errorCode?: string,
  ): Promise<void> {
    try {
      await this.usageService.recordUsage({
        userId: input.userId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        modelName: usage.model,
        conversationId: input.conversationId,
        success,
        errorCode,
        metadata: {
          feature: 'response_correction_replay',
          messageId: input.messageId,
          attemptNumber: input.attemptNumber,
          durationMs: usage.durationMs,
        },
      });
    } catch (error) {
      this.logger.warn('Failed to record corrective replay usage', {
        messageId: input.messageId,
        attemptNumber: input.attemptNumber,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async cleanupSession(
    userId: string,
    sessionId: string,
    idempotencyKey: string,
    messageId: string,
    replayRequestId: string,
  ): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await this.streamService.deleteConversationSession(userId, sessionId, idempotencyKey);
        return;
      } catch (error) {
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 100));
        else this.logger.warn('Corrective replay session cleanup failed', {
          messageId,
          replayRequestId,
          failureCode: 'corrective_replay_session_cleanup_failed',
          attempts: attempt,
        });
      }
    }
  }

  private async historyBefore(conversationId: string, questionMessageId: string): Promise<ConversationHistoryEntry[]> {
    const messages = await this.messageService.findAllByConversation(conversationId);
    const history: ConversationHistoryEntry[] = [];
    for (const message of messages) {
      if (message._id.toString() === questionMessageId) break;
      if (message.conversationType === 'user' && message.content?.trim()) {
        history.push({ role: 'CONVERSATION_HISTORY_ROLE_USER', text: message.content.slice(0, 30_000) });
      } else if (message.conversationType === 'ai') {
        const active = message.correctionWorkflow?.activeVersion === 'corrected'
          ? message.correctionWorkflow.correctedComponents
          : message.components as MessageComponent[] | undefined;
        const text = this.visibleText(active ?? []);
        if (text) history.push({ role: 'CONVERSATION_HISTORY_ROLE_ASSISTANT', text: text.slice(0, 30_000) });
      }
    }
    return history.slice(-40);
  }

  private visibleText(components: MessageComponent[]): string {
    return components
      .filter((component) => component.type === 'text')
      .map((component) => typeof component.data.content === 'string' ? component.data.content : typeof component.data.text === 'string' ? component.data.text : '')
      .filter(Boolean)
      .join('\n\n')
      .trim();
  }
}

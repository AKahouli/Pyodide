import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AgentService } from '@modules/agent/agent.service';
import { AgentTaskExecutionService, AgentTaskToolResult } from '@modules/agent/services/agent-task-execution.service';
import { SECOND_BRAIN_AGENT_SLUG } from '@modules/agent/services/playbook-assistant-connector-reconciler.service';
import { ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { RunSecondBrainTurnDto } from '../dto/playbook-assistant.dto';
import type { PlaybookMascotConfirmationDocument } from '../schemas/playbook-mascot-confirmation.schema';
import { PlaybookAssistantRequestService } from './playbook-assistant-request.service';

@Injectable()
export class SecondBrainService {
  constructor(
    private readonly agentService: AgentService,
    private readonly taskExecutionService: AgentTaskExecutionService,
    private readonly requestService: PlaybookAssistantRequestService,
  ) {}

  async runTurn(userId: string, dto: RunSecondBrainTurnDto) {
    const conversationId = dto.conversationId?.trim() || `second-brain:${randomUUID()}`;
    const agentId = await this.requireAgentId();
    const claimed = await this.requestService.claimTurn({
      requestId: dto.requestId,
      conversationId: dto.conversationId ? conversationId : undefined,
      ownerId: userId,
      tenantId: 'default',
      agentId,
      operationKind: 'generation',
      text: dto.message,
      context: dto.pageContext,
    });
    if (claimed.replay) {
      const response = claimed.request.responsePayload;
      return {
        ...(response ?? {
          conversationId: claimed.request.conversationId,
          correlationId: claimed.request.correlationId,
          answer: claimed.request.assistantAnswer ?? 'Yellowmind completed the request.',
          toolResults: [],
          pendingAction: null,
        }),
        requestId: claimed.request.requestId,
      };
    }
    try {
      const result = await this.execute(
        userId,
        claimed.request.conversationId,
        dto.message,
        dto.pageContext,
        claimed.request.correlationId,
        agentId,
        claimed.request.requestId,
      );
      await this.requestService.complete(
        claimed.request.requestId,
        result.answer,
        undefined,
        result as unknown as Record<string, unknown>,
      );
      return { ...result, requestId: claimed.request.requestId };
    } catch (error) {
      await this.requestService.fail(claimed.request.requestId);
      throw error;
    }
  }

  async continueConfirmed(userId: string, confirmation: PlaybookMascotConfirmationDocument) {
    const summary = confirmation.summary as { playbookName?: string; playbookId?: string };
    const canonicalArguments = JSON.stringify(confirmation.canonicalArguments)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');
    return this.execute(
      userId,
      confirmation.conversationId,
      `The user approved the native pending action for Playbook ${summary.playbookName || summary.playbookId || ''}. Call start_playbook_execution exactly once with this server-recorded JSON argument object, without adding, removing, or changing fields: ${canonicalArguments}`,
      undefined,
      confirmation.continuationCorrelationId,
    );
  }

  private async execute(
    userId: string,
    conversationId: string,
    message: string,
    pageContext?: Record<string, unknown>,
    correlationId = `second-brain:${randomUUID()}`,
    resolvedAgentId?: string,
    requestId?: string,
  ) {
    const agentId = resolvedAgentId ?? await this.requireAgentId();
    const trustedContext = pageContext
      ? `<trusted_page_context>${JSON.stringify(pageContext).slice(0, 5000)}</trusted_page_context>\n\n`
      : '';
    const result = await this.taskExecutionService.runSingleAgentTask({
      userId,
      agentId,
      query: `${trustedContext}${requestId ? `<trusted_assistant_request_id>${requestId}</trusted_assistant_request_id>\n\n` : ''}<user_request>${message.trim()}</user_request>`,
      attachedFiles: [],
      conversationId,
      correlationId,
      tenantId: 'default',
    });
    return {
      conversationId,
      correlationId,
      answer: result.text.trim() || 'My Second Brain completed the request.',
      toolResults: result.toolResults,
      pendingAction: this.findPendingAction(result.toolResults),
    };
  }

  private async requireAgentId(): Promise<string> {
    const agentId = await this.agentService.findActiveDefaultAgentIdBySlug(SECOND_BRAIN_AGENT_SLUG);
    if (!agentId) {
      throw new ServiceUnavailableException(ErrorCode.AGENT_UNAVAILABLE, 'Yellowmind is unavailable');
    }
    return agentId;
  }

  private findPendingAction(toolResults: AgentTaskToolResult[]): Record<string, unknown> | null {
    for (const toolResult of toolResults) {
      const pendingAction = this.findNestedPendingAction(toolResult.result);
      if (pendingAction) return pendingAction;
    }
    return null;
  }

  private findNestedPendingAction(value: unknown, depth = 0): Record<string, unknown> | null {
    if (depth > 5 || value == null) return null;
    if (typeof value === 'string') {
      try {
        return this.findNestedPendingAction(JSON.parse(value), depth + 1);
      } catch {
        return null;
      }
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const result = this.findNestedPendingAction(item, depth + 1);
        if (result) return result;
      }
      return null;
    }
    if (typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (record.pendingAction && typeof record.pendingAction === 'object') {
      return record.pendingAction as Record<string, unknown>;
    }
    for (const nested of Object.values(record)) {
      const result = this.findNestedPendingAction(nested, depth + 1);
      if (result) return result;
    }
    return null;
  }
}

import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AgentService } from '@modules/agent/agent.service';
import { AgentTaskExecutionService, AgentTaskToolResult } from '@modules/agent/services/agent-task-execution.service';
import { SECOND_BRAIN_AGENT_SLUG } from '@modules/agent/services/playbook-assistant-connector-reconciler.service';
import { ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { RunSecondBrainTurnDto } from '../dto/playbook-assistant.dto';
import type { PlaybookMascotConfirmationDocument } from '../schemas/playbook-mascot-confirmation.schema';

@Injectable()
export class SecondBrainService {
  constructor(
    private readonly agentService: AgentService,
    private readonly taskExecutionService: AgentTaskExecutionService,
  ) {}

  async runTurn(userId: string, dto: RunSecondBrainTurnDto) {
    const conversationId = dto.conversationId?.trim() || `second-brain:${randomUUID()}`;
    return this.execute(userId, conversationId, dto.message, dto.pageContext);
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
  ) {
    const agentId = await this.agentService.findActiveDefaultAgentIdBySlug(SECOND_BRAIN_AGENT_SLUG);
    if (!agentId) {
      throw new ServiceUnavailableException(ErrorCode.AGENT_UNAVAILABLE, 'My Second Brain is unavailable');
    }
    const trustedContext = pageContext
      ? `<trusted_page_context>${JSON.stringify(pageContext).slice(0, 5000)}</trusted_page_context>\n\n`
      : '';
    const result = await this.taskExecutionService.runSingleAgentTask({
      userId,
      agentId,
      query: `${trustedContext}<user_request>${message.trim()}</user_request>`,
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

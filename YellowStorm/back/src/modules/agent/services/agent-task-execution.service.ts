import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createGrpcMetadata } from '../../../common/grpc/grpc-security.util';
import { ServiceUnavailableException, BadRequestException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { StreamService } from '../../conversation/services/stream.service';
import { AgentService } from '../agent.service';
import { UsageService } from '../../usage/usage.service';

export interface GrpcAttachedFile { type: 'document'; document: { filepath: string; filename: string; workspace_name: string; workspace_id: string; source: string; createdAt: string; }; }
export interface GrpcWorkspaceContext { workspace_id: string; workspace_name?: string; }
export interface AgentTaskToolResult { name: string; status: 'completed' | 'failed'; result: unknown; }
export interface AgentTaskCitation {
  parentId?: string;
  source: string;
  fileName: string;
  page?: string;
  pageContent?: string;
  workspaceId?: string;
  reference?: string;
  highlightText?: string;
}

@Injectable()
export class AgentTaskExecutionService {
  private readonly logger = new Logger(AgentTaskExecutionService.name);
  constructor(private readonly config: ConfigService, @Inject(forwardRef(() => StreamService)) private readonly stream: StreamService, private readonly agents: AgentService, private readonly usageService: UsageService) {}

  async runSingleAgentTask(input: { userId: string; username?: string; agentId: string; query: string; attachedFiles: GrpcAttachedFile[]; correlationId: string; conversationId?: string; timeoutMs?: number; workspaceContext?: GrpcWorkspaceContext[]; usageEndpoint?: string }): Promise<{ text: string; toolResults: AgentTaskToolResult[]; citations: AgentTaskCitation[]; usage?: { inputTokens: number; outputTokens: number; model?: string } }> {
    await this.agents.assertActiveDefaultAgent(input.agentId);
    if (!(await this.stream.waitForGrpcReady(5_000))) throw new ServiceUnavailableException(ErrorCode.CHAT_GRPC_UNAVAILABLE, 'The AI runtime is unavailable');
    const client = this.stream.getChatbotClient();
    if (!client) throw new ServiceUnavailableException(ErrorCode.CHAT_GRPC_UNAVAILABLE, 'The AI runtime is unavailable');
    const conversationId = input.conversationId || `workspace-artifact:${input.correlationId}`;
    const [agent] = await this.agents.buildGrpcAgentsForPlaybook(
      input.userId,
      [input.agentId],
      undefined,
      conversationId,
      {
        conversationId,
        correlationId: input.correlationId,
      },
    );
    if (!agent) throw new BadRequestException(ErrorCode.AGENT_UNAVAILABLE, 'The decision-flow agent is unavailable');
    const request = { user_context: { user_id: input.userId, username: input.username || '' }, conversation_id: conversationId, query: input.query, agent, workspace_context: input.workspaceContext ?? [], attached_files: input.attachedFiles, previous_attached_files: [], skills: [], deep_search_enabled: false };
    const timeoutMs = input.timeoutMs ?? this.config.get<number>('conversation.grpcTimeoutMs', 120000);
    return new Promise((resolve, reject) => {
      const metadata = createGrpcMetadata(this.config); metadata.set('user', input.username || 'SYSTEM'); metadata.set('x-correlation-id', input.correlationId);
      const call = client.RunSingleAgent(request, metadata); let text = ''; const textComponents = new Map<string, string>(); const textComponentOrder: string[] = []; const toolResults: AgentTaskToolResult[] = []; const citations: AgentTaskCitation[] = []; let usage: { inputTokens: number; outputTokens: number; model?: string } | undefined; let terminalError = false; let settled = false; const startedAt = Date.now();
      const timer = setTimeout(() => { if (!settled) { settled = true; call.cancel(); reject(new ServiceUnavailableException(ErrorCode.AI_SERVICE_TIMEOUT, 'Decision-flow generation timed out')); } }, timeoutMs);
      call.on('data', (chunk: { action?: string; component?: { id?: string; text?: { content?: string }; error?: { title?: string; content?: string }; tool_activity?: { tool_name?: string; status?: string; result_json?: string }; citation?: { parent_id?: string; text_source?: { source?: string; file_name?: string; page?: string; page_content?: string; workspace_id?: string; reference?: string; highlight_text?: string } } }; usage?: { input_tokens?: number; output_tokens?: number; model?: string } }) => {
        if (chunk.component?.error) terminalError = true;
        const content = chunk.component?.text?.content;
        if (content && (chunk.action === 'add' || chunk.action === 'update')) {
          const componentId = chunk.component?.id;
          if (componentId) {
            if (!textComponents.has(componentId)) textComponentOrder.push(componentId);
            textComponents.set(componentId, chunk.action === 'update' ? `${textComponents.get(componentId) ?? ''}${content}` : content);
          } else {
            text += content;
          }
        }
        const toolActivity = chunk.component?.tool_activity;
        if (toolActivity?.tool_name && (toolActivity.status === 'completed' || toolActivity.status === 'failed') && toolActivity.result_json) {
          try {
            toolResults.push({ name: toolActivity.tool_name, status: toolActivity.status, result: JSON.parse(toolActivity.result_json) });
          } catch {
            this.logger.warn(`Ignored malformed structured tool result tool=${toolActivity.tool_name}`);
          }
        }
        const citation = chunk.component?.citation?.text_source;
        if (citation && (citation.source || citation.file_name || citation.page_content || citation.highlight_text)) {
          citations.push({
            parentId: chunk.component?.citation?.parent_id,
            source: citation.source ?? '',
            fileName: citation.file_name ?? '',
            page: citation.page || undefined,
            pageContent: citation.page_content || undefined,
            workspaceId: citation.workspace_id || undefined,
            reference: citation.reference || undefined,
            highlightText: citation.highlight_text || undefined,
          });
        }
        if (chunk.usage) usage = { inputTokens: (usage?.inputTokens ?? 0) + (chunk.usage.input_tokens ?? 0), outputTokens: (usage?.outputTokens ?? 0) + (chunk.usage.output_tokens ?? 0), model: chunk.usage.model ?? usage?.model };
      });
      call.on('error', (error: Error) => { if (!settled) { settled = true; clearTimeout(timer); reject(new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR, 'Decision-flow generation failed')); } });
      call.on('end', () => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (terminalError) {
          reject(new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR, 'Decision-flow generation failed'));
          return;
        }
        const finish = async () => {
          if (usage && (usage.inputTokens > 0 || usage.outputTokens > 0)) {
            try {
              await this.usageService.recordUsage({ userId: input.userId, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, modelName: usage.model, endpoint: input.usageEndpoint || 'workspace-artifact', durationMs: Date.now() - startedAt, metadata: { correlationId: input.correlationId } });
            } catch (error) {
              this.logger.warn(`Failed to record workspace artifact usage: ${error instanceof Error ? error.message : 'unknown error'}`);
            }
          }
          const finalTextComponentId = [...textComponentOrder]
            .reverse()
            .find((componentId) => (textComponents.get(componentId) ?? '').trim().length > 0);
          resolve({ text: finalTextComponentId ? textComponents.get(finalTextComponentId) ?? text : text, toolResults, citations, usage });
        };
        void finish();
      });
    });
  }
}

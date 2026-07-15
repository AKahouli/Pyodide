import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createGrpcMetadata } from '../../../common/grpc/grpc-security.util';
import { ServiceUnavailableException, BadRequestException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { StreamService } from '../../conversation/services/stream.service';
import { AgentService } from '../agent.service';
import { UsageService } from '../../usage/usage.service';

export interface GrpcAttachedFile { type: 'document'; document: { filepath: string; filename: string; workspace_name: string; workspace_id: string; source: string; createdAt: string; }; }

@Injectable()
export class AgentTaskExecutionService {
  private readonly logger = new Logger(AgentTaskExecutionService.name);
  constructor(private readonly config: ConfigService, @Inject(forwardRef(() => StreamService)) private readonly stream: StreamService, private readonly agents: AgentService, private readonly usageService: UsageService) {}

  async runSingleAgentTask(input: { userId: string; username?: string; agentId: string; query: string; attachedFiles: GrpcAttachedFile[]; correlationId: string; timeoutMs?: number }): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number; model?: string } }> {
    await this.agents.assertActiveDefaultAgent(input.agentId);
    if (!(await this.stream.waitForGrpcReady(5_000))) throw new ServiceUnavailableException(ErrorCode.CHAT_GRPC_UNAVAILABLE, 'The AI runtime is unavailable');
    const client = this.stream.getChatbotClient();
    if (!client) throw new ServiceUnavailableException(ErrorCode.CHAT_GRPC_UNAVAILABLE, 'The AI runtime is unavailable');
    const [agent] = await this.agents.buildGrpcAgentsForPlaybook(input.userId, [input.agentId], undefined, `workspace-artifact:${input.correlationId}`);
    if (!agent) throw new BadRequestException(ErrorCode.AGENT_UNAVAILABLE, 'The decision-flow agent is unavailable');
    const request = { user_context: { user_id: input.userId, username: input.username || '' }, conversation_id: `workspace-artifact:${input.correlationId}`, query: input.query, agent, workspace_context: [], attached_files: input.attachedFiles, previous_attached_files: [], skills: [], deep_search_enabled: false };
    const timeoutMs = input.timeoutMs ?? this.config.get<number>('conversation.grpcTimeoutMs', 120000);
    return new Promise((resolve, reject) => {
      const metadata = createGrpcMetadata(this.config); metadata.set('user', input.username || 'SYSTEM'); metadata.set('x-correlation-id', input.correlationId);
      const call = client.RunSingleAgent(request, metadata); let text = ''; let usage: { inputTokens: number; outputTokens: number; model?: string } | undefined; let settled = false; const startedAt = Date.now();
      const timer = setTimeout(() => { if (!settled) { settled = true; call.cancel(); reject(new ServiceUnavailableException(ErrorCode.AI_SERVICE_TIMEOUT, 'Decision-flow generation timed out')); } }, timeoutMs);
      call.on('data', (chunk: { action?: string; component?: { text?: { content?: string } }; usage?: { input_tokens?: number; output_tokens?: number; model?: string } }) => {
        const content = chunk.component?.text?.content;
        if (content && (chunk.action === 'add' || chunk.action === 'update')) text += content;
        if (chunk.usage) usage = { inputTokens: (usage?.inputTokens ?? 0) + (chunk.usage.input_tokens ?? 0), outputTokens: (usage?.outputTokens ?? 0) + (chunk.usage.output_tokens ?? 0), model: chunk.usage.model ?? usage?.model };
      });
      call.on('error', (error: Error) => { if (!settled) { settled = true; clearTimeout(timer); reject(new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR, 'Decision-flow generation failed')); } });
      call.on('end', () => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        const finish = async () => {
          if (usage && (usage.inputTokens > 0 || usage.outputTokens > 0)) {
            try {
              await this.usageService.recordUsage({ userId: input.userId, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, modelName: usage.model, endpoint: 'workspace-artifact', durationMs: Date.now() - startedAt, metadata: { correlationId: input.correlationId } });
            } catch (error) {
              this.logger.warn(`Failed to record workspace artifact usage: ${error instanceof Error ? error.message : 'unknown error'}`);
            }
          }
          resolve({ text, usage });
        };
        void finish();
      });
    });
  }
}

import { Injectable } from '@nestjs/common';
import { LoggerService } from '@modules/logger';
import { ModelsService } from '@modules/models/models.service';
import { LiteLLMConnectionService } from '@modules/models/litellm-connection.service';
import { BadRequestException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { PlaybookFlowStreamGatewayService } from './playbook-flow-stream-gateway.service';
import { PlaybookFlowPromptTemplateService } from './playbook-flow-prompt-template.service';
import { pLimit } from '../utils/p-limit';
import { ExecutionRepository } from '../persistence/execution.repository';
import { TaskResultRepository } from '../persistence/task-result.repository';
import { OutputFormatRepository, type OutputFormatRecord } from '../persistence/output-format.repository';

const FALLBACK_OUTPUT_FORMAT_GUIDE_SYSTEM_PROMPT = 'You are tasked with extracting and reproducing only the output structure and formatting from a given result.\nPreserve exact structural organization, section order, hierarchy, markdown formatting (headings, tables, bullets, paragraphs).\nKeep column structures and labels but leave cell values empty. Remove all factual content, values, numbers, sources, and conclusions.\nProduce a clean, reusable markdown template with structure only, no content.';

/** A task output as the text column holds it: Mongoose cast scalars to a string, an object is kept as JSON text. */
function outputText(output: unknown): string {
  if (typeof output === 'string') return output;
  return typeof output === 'object' ? JSON.stringify(output) : String(output);
}

@Injectable()
export class PlaybookFlowOutputFormatService {
  private readonly runGeneration = pLimit(1);

  constructor(
    private readonly outputFormats: OutputFormatRepository,
    private readonly executions: ExecutionRepository,
    private readonly taskResults: TaskResultRepository,
    private readonly modelsService: ModelsService,
    private readonly liteLLMConnectionService: LiteLLMConnectionService,
    private readonly streamGateway: PlaybookFlowStreamGatewayService,
    private readonly promptTemplateService: PlaybookFlowPromptTemplateService,
    private readonly logger: LoggerService,
  ) { this.logger.setContext('PlaybookFlowOutputFormatService'); }

  async captureFromExecution(userId: string, flowId: string, nodeId: string, executionId: string) {
    const execution = await this.executions.findById(executionId);
    if (!execution || execution.flowId !== flowId.toLowerCase()) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND);
    }

    const taskResult = await this.taskResults.findLatestForTask(execution.id, nodeId, {
      statuses: ['completed'], light: true, with: ['output'],
    });
    if (!taskResult || !taskResult.output) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST);
    }

    // Executions carry no number (the Mongo field never existed): the capture always recorded 1.
    const template = await this.outputFormats.capture({
      flowId: execution.flowId, nodeId, createdBy: userId,
      sourceExecutionId: execution.id,
      sourceExecutionNumber: 1,
      sourceOutput: outputText(taskResult.output),
    });

    this.enqueueGeneration(template.id);
    return this.mapToResponse(template);
  }

  async getActiveTemplate(flowId: string, nodeId: string) {
    const template = await this.outputFormats.findActive(flowId, nodeId);
    return template ? this.mapToResponse(template) : null;
  }

  async updateTemplate(
    flowId: string, nodeId: string, dto: { formatGuide?: string; preserveOutputFormat?: boolean },
  ) {
    const template = await this.outputFormats.updateActive(flowId, nodeId, { formatGuide: dto.formatGuide });
    if (!template) return null;
    return this.mapToResponse(template);
  }

  async deleteTemplate(flowId: string, nodeId: string): Promise<void> {
    await this.outputFormats.archiveActive(flowId, nodeId);
  }

  async getActiveTemplates(flowId: string, nodeIds: string[]): Promise<Map<string, any>> {
    if (!nodeIds.length) return new Map();
    const templates = await this.outputFormats.listActive(flowId, nodeIds);
    const result = new Map<string, any>();
    for (const t of templates) result.set(t.nodeId, this.mapToResponse(t));
    return result;
  }

  private enqueueGeneration(templateId: string): void {
    void this.runGeneration(async () => {
      await this.generateInBackground(templateId);
    }).catch((err) => this.logger.warn('Async format generation failed', { templateId, error: (err as Error).message }));
  }

  private async generateInBackground(templateId: string): Promise<void> {
    const source = await this.outputFormats.findById(templateId);
    if (!source) return;
    let template: OutputFormatRecord | null;
    try {
      const guide = await this.buildFormatGuide(source.sourceOutput || '');
      template = await this.outputFormats.setGeneration(templateId, {
        formatGuide: guide,
        generationStatus: guide ? 'ready' : 'failed',
        generationError: guide ? null : 'Empty guide generated',
      });
    } catch (err) {
      template = await this.outputFormats.setGeneration(templateId, {
        formatGuide: source.formatGuide,
        generationStatus: 'failed',
        generationError: (err as Error).message,
      });
    }
    if (!template) return;

    const userId = template.createdBy;
    const flowId = template.flowId;
    if (userId && flowId) {
      this.streamGateway.sendToUser(userId, {
        type: 'playbook_output_format_template_updated',
        data: {
          playbookId: flowId,
          taskId: template.nodeId,
          template: this.mapToResponse(template),
        },
      });
    }
  }

  private async buildFormatGuide(sourceOutput: string): Promise<string | null> {
    if (!sourceOutput?.trim()) return null;
    const httpClient = this.liteLLMConnectionService.getHttpClient();
    if (!httpClient) return this.getFallbackGuide(sourceOutput);
    const defaultModel = await this.modelsService.getDefaultModel();
    const model = defaultModel?.id || defaultModel?.litellmModel || '';
    if (!model) return this.getFallbackGuide(sourceOutput);

    const promptTemplate = await this.promptTemplateService.findByKey('output_format.guide');
    const systemPrompt = promptTemplate?.enabled && promptTemplate.systemTemplate?.trim()
      ? promptTemplate.systemTemplate.trim()
      : FALLBACK_OUTPUT_FORMAT_GUIDE_SYSTEM_PROMPT;

    try {
      const response = await httpClient.post('/v1/chat/completions', {
        model, temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `<result_to_describe>\n${sourceOutput}\n</result_to_describe>` },
        ],
      }, { timeout: 30000 });
      const content = response.data?.choices?.[0]?.message?.content;
      return (typeof content === 'string' && content.trim()) ? content.trim() : null;
    } catch {
      return this.getFallbackGuide(sourceOutput);
    }
  }

  private getFallbackGuide(sourceOutput: string): string {
    return `# Output format guide\n\n- Preserve markdown structure\n- Preserve heading hierarchy, tables, lists\n- Update content with current evidence\n\n## Reference\n\n${sourceOutput}`;
  }

  private mapToResponse(template: OutputFormatRecord) {
    return {
      id: template.id,
      flowId: template.flowId,
      nodeId: template.nodeId,
      sourceExecutionId: template.sourceExecutionId,
      sourceExecutionNumber: template.sourceExecutionNumber,
      templateVersion: template.templateVersion,
      status: template.status,
      generationStatus: template.generationStatus,
      generationError: template.generationError ?? null,
      formatGuide: template.formatGuide ?? null,
      llmPromptTrace: template.llmPromptTrace || [],
      createdAt: template.createdAt.toISOString(),
      updatedAt: template.updatedAt.toISOString(),
    };
  }
}

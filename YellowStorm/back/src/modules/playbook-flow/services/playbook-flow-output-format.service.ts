import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoggerService } from '@modules/logger';
import { ModelsService } from '@modules/models/models.service';
import { LiteLLMConnectionService } from '@modules/models/litellm-connection.service';
import { FlowExecution, FlowExecutionDocument } from '../schemas/playbook-flow-execution.schema';
import {
  OutputFormatGenerationStatus, OutputFormatStatus,
  FlowOutputFormat, FlowOutputFormatDocument,
} from '../schemas/playbook-flow-output-format.schema';
import { BadRequestException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { pLimit } from '@modules/playbook/utils/execution.utils';

const OUTPUT_FORMAT_GUIDE_SYSTEM_PROMPT = `You are tasked with extracting and reproducing only the output structure and formatting from a given result.
Preserve exact structural organization, section order, hierarchy, markdown formatting (headings, tables, bullets, paragraphs).
Keep column structures and labels but leave cell values empty. Remove all factual content, values, numbers, sources, and conclusions.
Produce a clean, reusable markdown template with structure only, no content.`;

@Injectable()
export class PlaybookFlowOutputFormatService {
  private readonly runGeneration = pLimit(1);

  constructor(
    @InjectModel(FlowOutputFormat.name) private readonly templateModel: Model<FlowOutputFormatDocument>,
    @InjectModel(FlowExecution.name) private readonly executionModel: Model<FlowExecutionDocument>,
    private readonly modelsService: ModelsService,
    private readonly liteLLMConnectionService: LiteLLMConnectionService,
    private readonly logger: LoggerService,
  ) { this.logger.setContext('PlaybookFlowOutputFormatService'); }

  async captureFromExecution(userId: string, flowId: string, nodeId: string, executionId: string) {
    const execution = await this.executionModel.findById(executionId).lean().exec();
    if (!execution || (execution as any).flowId?.toString() !== flowId) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND);
    }

    const taskResults = (execution as any).taskResults || [];
    const taskResult = taskResults.find((item: any) => item.nodeId === nodeId);
    if (!taskResult || taskResult.status !== 'completed' || !taskResult.output) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST);
    }

    const version = (await this.templateModel.countDocuments({ flowId: new Types.ObjectId(flowId), nodeId })) + 1;
    await this.templateModel.updateMany(
      { flowId: new Types.ObjectId(flowId), nodeId, status: { $in: [OutputFormatStatus.ACTIVE, OutputFormatStatus.INACTIVE] } },
      { $set: { status: OutputFormatStatus.INACTIVE } },
    );

    const template = await this.templateModel.create({
      flowId: new Types.ObjectId(flowId), nodeId, createdBy: new Types.ObjectId(userId),
      sourceExecutionId: new Types.ObjectId(executionId),
      sourceExecutionNumber: (execution as any).executionNumber || 1,
      templateVersion: version, status: OutputFormatStatus.ACTIVE,
      generationStatus: OutputFormatGenerationStatus.PENDING,
      generationError: null, sourceOutput: taskResult.output,
      formatGuide: null, llmPromptTrace: [],
    });

    this.enqueueGeneration(template._id.toString());
    return this.mapToResponse(template.toJSON());
  }

  async getActiveTemplate(flowId: string, nodeId: string) {
    const template = await this.templateModel.findOne({
      flowId: new Types.ObjectId(flowId), nodeId, status: OutputFormatStatus.ACTIVE,
    }).lean().exec();
    return template ? this.mapToResponse(template) : null;
  }

  async getActiveTemplates(flowId: string, nodeIds: string[]): Promise<Map<string, any>> {
    if (!nodeIds.length) return new Map();
    const templates = await this.templateModel.find({
      flowId: new Types.ObjectId(flowId), nodeId: { $in: nodeIds },
      status: OutputFormatStatus.ACTIVE,
    }).lean().exec();
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
    const template = await this.templateModel.findById(templateId).exec();
    if (!template) return;
    try {
      const guide = await this.buildFormatGuide(template.sourceOutput || '');
      template.formatGuide = guide;
      template.generationStatus = guide ? OutputFormatGenerationStatus.READY : OutputFormatGenerationStatus.FAILED;
      template.generationError = guide ? null : 'Empty guide generated';
      await template.save();
    } catch (err) {
      template.generationStatus = OutputFormatGenerationStatus.FAILED;
      template.generationError = (err as Error).message;
      await template.save();
    }
  }

  private async buildFormatGuide(sourceOutput: string): Promise<string | null> {
    if (!sourceOutput?.trim()) return null;
    const httpClient = this.liteLLMConnectionService.getHttpClient();
    if (!httpClient) return this.getFallbackGuide(sourceOutput);
    const defaultModel = await this.modelsService.getDefaultModel();
    const model = defaultModel?.id || defaultModel?.litellmModel || '';
    if (!model) return this.getFallbackGuide(sourceOutput);

    try {
      const response = await httpClient.post('/v1/chat/completions', {
        model, temperature: 0,
        messages: [
          { role: 'system', content: OUTPUT_FORMAT_GUIDE_SYSTEM_PROMPT },
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

  private mapToResponse(template: any) {
    return {
      id: (template._id || template.id).toString(),
      flowId: template.flowId?.toString?.() || template.flowId,
      nodeId: template.nodeId,
      sourceExecutionId: template.sourceExecutionId?.toString?.() || template.sourceExecutionId,
      sourceExecutionNumber: template.sourceExecutionNumber,
      templateVersion: template.templateVersion,
      status: template.status,
      generationStatus: template.generationStatus,
      generationError: template.generationError ?? null,
      formatGuide: template.formatGuide ?? null,
      llmPromptTrace: template.llmPromptTrace || [],
      createdAt: template.createdAt?.toISOString?.() || template.createdAt,
      updatedAt: template.updatedAt?.toISOString?.() || template.updatedAt,
    };
  }
}

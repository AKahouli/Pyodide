import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PlaybookValidatedReplay,
  PlaybookValidatedReplayDocument,
  ReplayFormatGuideStatus,
  ReplayValidationMode,
  ReplayValidationStatus,
} from '../schemas/playbook-validated-replay.schema';
import { Playbook, PlaybookDocument } from '../schemas/playbook.schema';
import {
  PlaybookExecution,
  PlaybookExecutionDocument,
  StepStatus,
} from '../schemas/playbook-execution.schema';
import { BadRequestException, ForbiddenException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { LoggerService } from '../../logger';
import { ModelsService } from '../../models/models.service';
import { LiteLLMConnectionService } from '../../models/litellm-connection.service';
import { pLimit } from '../utils/execution.utils';
import { PlaybookStreamGatewayService } from './playbook-stream-gateway.service';

const OUTPUT_FORMAT_GUIDE_SYSTEM_PROMPT = `# 🎯 System Prompt — Extraction of Output Structure (No Facts)
You are expert in prompt engineering, you are tasked with extracting and reproducing only the output structure and formatting instructions from a given result exposed in <result_to_describe> block .
Your generated prompt will be used by an another ai agent to format its output generation

---

## 🧩 Global Instructions

- Preserve the **exact structural organization** of the document.
- Maintain the **same section order and hierarchy**.
- Use **markdown formatting consistently**:
  - Section headings (\`##\`, \`###\`)
  - Tables
  - Bullet points
  - Paragraph spacing
- Keep **column structures and labels**, but leave all cell values empty or as placeholders.
- Preserve **icons/emojis in section titles** where present.
- Maintain **paragraph blocks and explanatory text placement**, but remove factual content.
- Do **not** include numeric values, product names, sources, or conclusions.

## 🚫 Strict Constraints

- ❌ No real data
- ❌ No numbers or percentages
- ❌ No product/service names
- ❌ No references or sources
- ❌ No inferred conclusions

---

## ✅ Goal

Produce a **clean, reusable markdown template** that mirrors the original output’s:

- Layout
- Hierarchy
- Formatting
- Presentation logic

...while containing **structure only, with no content**.
`;
const OUTPUT_FORMAT_GUIDE_TIMEOUT_MS = 30000;

@Injectable()
export class PlaybookReplayService {
  private readonly runFormatGuideGeneration = pLimit(1);

  constructor(
    @InjectModel(PlaybookValidatedReplay.name)
    private readonly replayModel: Model<PlaybookValidatedReplayDocument>,
    @InjectModel(Playbook.name)
    private readonly playbookModel: Model<PlaybookDocument>,
    @InjectModel(PlaybookExecution.name)
    private readonly executionModel: Model<PlaybookExecutionDocument>,
    private readonly modelsService: ModelsService,
    private readonly liteLLMConnectionService: LiteLLMConnectionService,
    private readonly streamGateway: PlaybookStreamGatewayService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('PlaybookReplayService');
  }

  private getOutputFormatGuideFallback(referenceOutput: string | null | undefined): string | null {
    const text = (referenceOutput || '').trim();
    if (!text) {
      return null;
    }
    return [
      '# Output format guide',
      '',
      '- Preserve the markdown structure of the validated output.',
      '- Preserve heading hierarchy, tables, bullet lists, and spacing when present.',
      '- Keep section order and presentation logic unchanged.',
      '- Replace all factual content with generic placeholders in this guide.',
      '- During replay synthesis, use current evidence only and do not copy stale facts from the baseline.',
    ].join('\n');
  }

  private extractChatCompletionText(responseData: any): string | null {
    const content = responseData?.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
      return content.trim() || null;
    }

    if (Array.isArray(content)) {
      const text = content
        .map((item) => (typeof item?.text === 'string' ? item.text : ''))
        .join('\n')
        .trim();
      return text || null;
    }

    return null;
  }

  private async buildOutputFormatGuide(referenceOutput: string | null | undefined): Promise<{
    guide: string | null;
    promptTrace: Array<{ stage: string; model: string; prompt: string }>;
  }> {
    const text = (referenceOutput || '').trim();
    if (!text) {
      return { guide: null, promptTrace: [] };
    }

    const httpClient = this.liteLLMConnectionService.getHttpClient();
    if (!httpClient) {
      this.logger.warn('Skipping LLM output format guide generation: LiteLLM client unavailable');
      return { guide: this.getOutputFormatGuideFallback(text), promptTrace: [] };
    }

    const defaultModel = await this.modelsService.getDefaultModel();
    const model = defaultModel?.id || defaultModel?.litellmModel || '';
    if (!model) {
      this.logger.warn('Skipping LLM output format guide generation: no default model configured');
      return { guide: this.getOutputFormatGuideFallback(text), promptTrace: [] };
    }

    const promptTrace = [
      {
        stage: 'output_format_guide_generation',
        model,
        prompt: `[SYSTEM]\n${OUTPUT_FORMAT_GUIDE_SYSTEM_PROMPT}\n\n[USER]\n<result_to_describe>\n${text}\n</result_to_describe>`,
      },
    ];

    try {
      const startedAt = Date.now();
      const response = await httpClient.post('/v1/chat/completions', {
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: OUTPUT_FORMAT_GUIDE_SYSTEM_PROMPT },
          { role: 'user', content: `<result_to_describe>\n${text}\n</result_to_describe>` },
        ],
      }, {
        timeout: OUTPUT_FORMAT_GUIDE_TIMEOUT_MS,
      });

      const generatedGuide = this.extractChatCompletionText(response.data);
      if (generatedGuide) {
        this.logger.log('Generated output format guide with LiteLLM', {
          model,
          durationMs: Date.now() - startedAt,
          outputLength: generatedGuide.length,
        });
        return { guide: generatedGuide, promptTrace };
      }

      this.logger.warn('LiteLLM returned an empty output format guide, using fallback', {
        model,
        durationMs: Date.now() - startedAt,
      });
      return { guide: this.getOutputFormatGuideFallback(text), promptTrace };
    } catch (error) {
      this.logger.warn('Failed to generate output format guide with LiteLLM, using fallback', {
        error: error instanceof Error ? error.message : 'Unknown error',
        model,
        timeoutMs: OUTPUT_FORMAT_GUIDE_TIMEOUT_MS,
      });
      return { guide: this.getOutputFormatGuideFallback(text), promptTrace };
    }
  }

  private enqueueOutputFormatGuideGeneration(replayId: string): void {
    void this.runFormatGuideGeneration(async () => {
      await this.generateOutputFormatGuideInBackground(replayId);
    }).catch((error) => {
      this.logger.warn('Async format guide generation failed', {
        replayId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });
  }

  private emitFormatGuideUpdated(userId: string, replay: any, playbook: any | null): void {
    this.streamGateway.sendToUser(userId, {
      type: 'playbook_replay_format_guide_updated',
      data: {
        playbookId: replay.playbookId.toString(),
        taskId: replay.taskId,
        replay: this.mapReplayToResponse(replay.toJSON ? replay.toJSON() : replay, playbook),
      },
    });
  }

  private async generateOutputFormatGuideInBackground(replayId: string): Promise<void> {
    const replay = await this.replayModel.findById(replayId).exec();
    if (!replay || !replay.preserveOutputFormat) {
      return;
    }

    try {
      const generated = await this.buildOutputFormatGuide(replay.referenceOutput);
      replay.outputFormatGuide = generated.guide;
      replay.llmPromptTrace = generated.promptTrace;
      replay.formatGuideStatus = generated.guide
        ? ReplayFormatGuideStatus.READY
        : ReplayFormatGuideStatus.FAILED;
      replay.formatGuideError = generated.guide ? null : 'Empty guide generated';
      await replay.save();
      const playbook = await this.playbookModel.findById(replay.playbookId).lean().exec();
      this.emitFormatGuideUpdated(replay.createdBy.toString(), replay, playbook);

      this.logger.log('Replay format guide enrichment completed', {
        replayId,
        status: replay.formatGuideStatus,
        hasGuide: Boolean(replay.outputFormatGuide),
      });
    } catch (error) {
      replay.formatGuideStatus = ReplayFormatGuideStatus.FAILED;
      replay.formatGuideError = error instanceof Error ? error.message : 'Unknown error';
      await replay.save();
      const playbook = await this.playbookModel.findById(replay.playbookId).lean().exec();
      this.emitFormatGuideUpdated(replay.createdBy.toString(), replay, playbook);
      throw error;
    }
  }

  private normalizeStructLike(value: any): any {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeStructLike(item));
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    if ('stringValue' in value) return value.stringValue;
    if ('numberValue' in value) return value.numberValue;
    if ('boolValue' in value) return value.boolValue;
    if ('nullValue' in value) return null;
    if ('listValue' in value) {
      const list = value.listValue?.values || value.listValue || [];
      return Array.isArray(list) ? list.map((item: any) => this.normalizeStructLike(item)) : [];
    }
    if ('structValue' in value) {
      return this.normalizeStructLike(value.structValue);
    }
    if ('fields' in value && Object.keys(value).length === 1) {
      return Object.entries(value.fields || {}).reduce<Record<string, unknown>>((acc, [key, fieldValue]) => {
        acc[key] = this.normalizeStructLike(fieldValue);
        return acc;
      }, {});
    }

    return Object.entries(value).reduce<Record<string, unknown>>((acc, [key, nestedValue]) => {
      acc[key] = this.normalizeStructLike(nestedValue);
      return acc;
    }, {});
  }

  async validateTaskReplay(
    userId: string,
    playbookId: string,
    taskId: string,
    executionId: string,
    preserveOutputFormat = false,
  ) {
    const execution = await this.executionModel.findOne({
      _id: new Types.ObjectId(executionId),
      playbookId: new Types.ObjectId(playbookId),
    }).lean().exec();

    if (!execution) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_EXECUTION_NOT_FOUND);
    }

    if (execution.executedBy?.toString() !== userId) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN);
    }

    const taskResult = (execution.taskResults || []).find((tr: any) => tr.taskId === taskId);
    if (!taskResult) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_EXECUTION_NOT_FOUND, 'Task result not found in execution');
    }

    if (taskResult.status !== StepStatus.COMPLETED) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Only completed task executions can be validated');
    }

    if (!taskResult.toolTrace || taskResult.toolTrace.length === 0) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Task execution has no replayable tool trace');
    }

    const playbook = await this.playbookModel.findById(playbookId).lean().exec();
    if (!playbook) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND);
    }

    const snapshotTask = (execution.playbookSnapshot as any)?.tasks?.find((task: any) => task.id === taskId);
    const referenceTaskDescription = snapshotTask?.description || '';
    const referenceAssignedAgentId = snapshotTask?.assignedAgentId?.toString?.()
      || snapshotTask?.assignedAgentId
      || null;
    const referenceWorkspaceIds = (playbook.workspaces || []).map((workspaceId: any) => workspaceId.toString());

    const latest = await this.replayModel
      .findOne({ playbookId: new Types.ObjectId(playbookId), taskId })
      .sort({ validationVersion: -1 })
      .select('validationVersion')
      .lean()
      .exec();

    const validationVersion = (latest?.validationVersion || 0) + 1;

    await this.replayModel.updateMany(
      {
        playbookId: new Types.ObjectId(playbookId),
        taskId,
        status: ReplayValidationStatus.ACTIVE,
      },
      { $set: { status: ReplayValidationStatus.INACTIVE } },
    );

    const replay = await this.replayModel.create({
      playbookId: new Types.ObjectId(playbookId),
      taskId,
      taskTitle: taskResult.nodeTitle,
      referenceTaskDescription,
      referenceAssignedAgentId,
      referenceWorkspaceIds,
      agentName: taskResult.agentName || '',
      createdBy: new Types.ObjectId(userId),
      referenceExecutionId: new Types.ObjectId(executionId),
      referenceExecutionNumber: execution.executionNumber,
      validationVersion,
      status: ReplayValidationStatus.ACTIVE,
      mode: ReplayValidationMode.STRICT_REPLAY,
      toolCalls: taskResult.toolTrace,
      referenceOutput: taskResult.output || null,
      preserveOutputFormat,
      outputFormatGuide: null,
      formatGuideStatus: preserveOutputFormat ? ReplayFormatGuideStatus.PENDING : ReplayFormatGuideStatus.DISABLED,
      formatGuideError: null,
      llmPromptTrace: [],
    });

    if (preserveOutputFormat) {
      this.enqueueOutputFormatGuideGeneration(replay._id.toString());
    }

    this.logger.log('Validated task replay created', {
      playbookId,
      taskId,
      executionId,
      replayId: replay._id.toString(),
      validationVersion,
      toolCallCount: taskResult.toolTrace.length,
    });

    return this.mapReplayToResponse(replay.toJSON());
  }

  async listTaskReplays(playbookId: string, taskId: string) {
    const playbook = await this.playbookModel.findById(playbookId).lean().exec();
    const replays = await this.replayModel
      .find({ playbookId: new Types.ObjectId(playbookId), taskId })
      .sort({ validationVersion: -1 })
      .lean()
      .exec();

    return replays.map((replay) => this.mapReplayToResponse(replay, playbook));
  }

  async activateTaskReplay(playbookId: string, taskId: string, replayId: string) {
    const replay = await this.replayModel.findOne({
      _id: new Types.ObjectId(replayId),
      playbookId: new Types.ObjectId(playbookId),
      taskId,
    }).exec();

    if (!replay) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND, 'Validated replay not found');
    }

    if (replay.status === ReplayValidationStatus.ARCHIVED) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Archived replay cannot be activated');
    }

    await this.replayModel.updateMany(
      {
        playbookId: new Types.ObjectId(playbookId),
        taskId,
        _id: { $ne: replay._id },
        status: { $in: [ReplayValidationStatus.ACTIVE, ReplayValidationStatus.INACTIVE] },
      },
      { $set: { status: ReplayValidationStatus.INACTIVE } },
    );

    replay.status = ReplayValidationStatus.ACTIVE;
    await replay.save();

    this.logger.log('Validated task replay activated', {
      playbookId,
      taskId,
      replayId,
      validationVersion: replay.validationVersion,
    });

    const playbook = await this.playbookModel.findById(playbookId).lean().exec();
    return this.mapReplayToResponse(replay.toJSON(), playbook);
  }

  async updateTaskReplayFormatGuide(
    playbookId: string,
    taskId: string,
    replayId: string,
    dto: { preserveOutputFormat?: boolean; outputFormatGuide?: string },
  ) {
    const replay = await this.replayModel.findOne({
      _id: new Types.ObjectId(replayId),
      playbookId: new Types.ObjectId(playbookId),
      taskId,
    }).exec();

    if (!replay) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND, 'Validated replay not found');
    }

    if (dto.preserveOutputFormat !== undefined) {
      replay.preserveOutputFormat = dto.preserveOutputFormat;
    }

    if (dto.outputFormatGuide !== undefined) {
      const nextGuide = dto.outputFormatGuide.trim();
      replay.outputFormatGuide = nextGuide || null;
      if (nextGuide) {
        replay.preserveOutputFormat = true;
        replay.formatGuideStatus = ReplayFormatGuideStatus.READY;
        replay.formatGuideError = null;
        replay.llmPromptTrace = [];
      } else if (replay.preserveOutputFormat) {
        replay.formatGuideStatus = ReplayFormatGuideStatus.PENDING;
        replay.formatGuideError = null;
        replay.llmPromptTrace = [];
      }
    } else if (replay.preserveOutputFormat && !replay.outputFormatGuide) {
      replay.formatGuideStatus = ReplayFormatGuideStatus.PENDING;
      replay.formatGuideError = null;
    }

    if (!replay.preserveOutputFormat) {
      replay.outputFormatGuide = null;
      replay.formatGuideStatus = ReplayFormatGuideStatus.DISABLED;
      replay.formatGuideError = null;
      replay.llmPromptTrace = [];
    }

    await replay.save();

    if (replay.preserveOutputFormat && !replay.outputFormatGuide && replay.formatGuideStatus === ReplayFormatGuideStatus.PENDING) {
      this.enqueueOutputFormatGuideGeneration(replay._id.toString());
    }

    this.logger.log('Validated task replay format guide updated', {
      playbookId,
      taskId,
      replayId,
      preserveOutputFormat: replay.preserveOutputFormat,
      hasOutputFormatGuide: Boolean(replay.outputFormatGuide),
    });

    const playbook = await this.playbookModel.findById(playbookId).lean().exec();
    this.emitFormatGuideUpdated(replay.createdBy.toString(), replay, playbook);
    return this.mapReplayToResponse(replay.toJSON(), playbook);
  }

  async getActiveReplay(playbookId: string, taskId: string) {
    const playbook = await this.playbookModel.findById(playbookId).lean().exec();
    const replay = await this.replayModel.findOne({
      playbookId: new Types.ObjectId(playbookId),
      taskId,
      status: ReplayValidationStatus.ACTIVE,
    }).lean().exec();

    return replay ? this.mapReplayToResponse(replay, playbook) : null;
  }

  async getActiveReplays(playbookId: string, taskIds: string[]) {
    if (taskIds.length === 0) {
      return new Map<string, any>();
    }

    const playbook = await this.playbookModel.findById(playbookId).lean().exec();
    const replays = await this.replayModel.find({
      playbookId: new Types.ObjectId(playbookId),
      taskId: { $in: taskIds },
      status: ReplayValidationStatus.ACTIVE,
    }).lean().exec();

    const replayMap = new Map<string, any>();
    for (const replay of replays) {
      replayMap.set(replay.taskId, this.mapReplayToResponse(replay, playbook));
    }
    return replayMap;
  }

  private computeReplayStaleness(replay: any, playbook: any | null) {
    const staleReasons: string[] = [];
    if (!playbook) {
      return { isStale: false, staleReasons };
    }

    const currentTask = (playbook.tasks || []).find((task: any) => task.id === replay.taskId);
    if (!currentTask) {
      staleReasons.push('Task no longer exists in the playbook');
      return { isStale: true, staleReasons };
    }

    const currentTitle = currentTask.title || '';
    const currentDescription = currentTask.description || '';
    const currentAssignedAgentId = currentTask.assignedAgentId?.toString?.() || currentTask.assignedAgentId || null;
    const currentWorkspaceIds = (playbook.workspaces || []).map((workspaceId: any) => workspaceId.toString()).sort();
    const referenceWorkspaceIds = [...(replay.referenceWorkspaceIds || [])].sort();

    if ((replay.taskTitle || '') !== currentTitle) {
      staleReasons.push('Task title changed');
    }
    if ((replay.referenceTaskDescription || '') !== currentDescription) {
      staleReasons.push('Task description changed');
    }
    if ((replay.referenceAssignedAgentId || null) !== currentAssignedAgentId) {
      staleReasons.push('Assigned agent changed');
    }
    if (JSON.stringify(referenceWorkspaceIds) !== JSON.stringify(currentWorkspaceIds)) {
      staleReasons.push('Workspace scope changed');
    }

    return { isStale: staleReasons.length > 0, staleReasons };
  }

  private mapReplayToResponse(replay: any, playbook: any | null = null) {
    const { isStale, staleReasons } = this.computeReplayStaleness(replay, playbook);
    return {
      id: (replay._id || replay.id).toString(),
      playbookId: replay.playbookId.toString(),
      taskId: replay.taskId,
      taskTitle: replay.taskTitle,
      referenceTaskDescription: replay.referenceTaskDescription || '',
      referenceAssignedAgentId: replay.referenceAssignedAgentId || null,
      referenceWorkspaceIds: replay.referenceWorkspaceIds || [],
      agentName: replay.agentName || '',
      createdBy: replay.createdBy.toString(),
      referenceExecutionId: replay.referenceExecutionId.toString(),
      referenceExecutionNumber: replay.referenceExecutionNumber,
      validationVersion: replay.validationVersion,
      status: replay.status,
      mode: replay.mode,
      toolCalls: (replay.toolCalls || []).map((call: any) => ({
        callIndex: call.callIndex,
        toolName: call.toolName,
        args: this.normalizeStructLike(call.args || {}),
        outputSummary: call.outputSummary ?? null,
      })),
      referenceOutput: replay.referenceOutput ?? null,
      preserveOutputFormat: Boolean(replay.preserveOutputFormat),
      outputFormatGuide: replay.outputFormatGuide ?? null,
      formatGuideStatus: replay.formatGuideStatus || ReplayFormatGuideStatus.DISABLED,
      formatGuideError: replay.formatGuideError ?? null,
      llmPromptTrace: replay.llmPromptTrace || [],
      isStale,
      staleReasons,
      createdAt: replay.createdAt?.toISOString?.() || replay.createdAt,
      updatedAt: replay.updatedAt?.toISOString?.() || replay.updatedAt,
    };
  }
}

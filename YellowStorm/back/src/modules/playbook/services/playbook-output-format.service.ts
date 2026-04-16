import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoggerService } from '../../logger';
import { ModelsService } from '../../models/models.service';
import { LiteLLMConnectionService } from '../../models/litellm-connection.service';
import { PlaybookStreamGatewayService } from './playbook-stream-gateway.service';
import { PlaybookExecution, PlaybookExecutionDocument, StepStatus } from '../schemas/playbook-execution.schema';
import { Playbook, PlaybookDocument } from '../schemas/playbook.schema';
import {
  OutputFormatGenerationStatus,
  OutputFormatTemplateStatus,
  PlaybookOutputFormatTemplate,
  PlaybookOutputFormatTemplateDocument,
} from '../schemas/playbook-output-format-template.schema';
import { BadRequestException, NotFoundException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { pLimit } from '../utils/execution.utils';
import { UpdateOutputFormatTemplateDto } from '../dto/update-output-format-template.dto';

const OUTPUT_FORMAT_GUIDE_SYSTEM_PROMPT = `# 🎯 System Prompt — Extraction of Output Structure (No Facts)

You are tasked with extracting and reproducing **only the output structure and formatting** from a given result ( in <result_to_describe> block) .
⚠️ Do **not** include, infer, or reuse any factual content, values, numbers, or source references.

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

---

## 📑 Expected Output Structure

### 1. Section Heading
- Use a numbered section title with an emoji.
- Example format:

\`\`\`markdown
## 1. [Section Title] 🎯
\`\`\`

---

### 2. Tabular Structure (Primary Tables)

Each section may contain a table with:

- A header row defining categories
- Multiple rows representing structured items

#### Table Format

\`\`\`markdown
| Column 1 | Column 2 | Column 3 | Column 4 |
|----------|----------|----------|----------|
|          |          |          |          |
|          |          |          |          |
\`\`\`

- Preserve:
  - Column count
  - Column order
  - Column naming style (genericized if needed)
- Do **not** include real values.

---

### 3. Paragraph Block (Explanatory Text)

- Include a short explanatory paragraph after the table.
- Maintain placement and tone (formal, analytical).
- Remove all factual references and citations.

\`\`\`markdown
[Generic explanatory paragraph about the section structure and interpretation]
\`\`\`

---

### 4. Secondary Section (Same Pattern)

Repeat the same structure for the next section:

- Section heading with emoji
- Table with:
  - Different column labels (structure preserved)
- Optional bullet list or notes

---

### 5. Bullet List (If Present)

If the section includes notes:

\`\`\`markdown
- [Generic statement]
- [Generic statement]
\`\`\`

- Preserve bullet formatting.
- Do **not** include actual facts or values.

---

## 🔁 Structural Consistency Rules

- Keep **uniform spacing between sections**.
- Maintain **visual separation between tables and text**.
- Preserve **relative proportions of content blocks**.
- Keep **approximately the same number of rows per table**, but empty.

---

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
export class PlaybookOutputFormatService {
  private readonly runGeneration = pLimit(1);

  constructor(
    @InjectModel(PlaybookOutputFormatTemplate.name)
    private readonly templateModel: Model<PlaybookOutputFormatTemplateDocument>,
    @InjectModel(PlaybookExecution.name)
    private readonly executionModel: Model<PlaybookExecutionDocument>,
    @InjectModel(Playbook.name)
    private readonly playbookModel: Model<PlaybookDocument>,
    private readonly modelsService: ModelsService,
    private readonly liteLLMConnectionService: LiteLLMConnectionService,
    private readonly streamGateway: PlaybookStreamGatewayService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('PlaybookOutputFormatService');
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

  private getFallbackGuide(sourceOutput: string): string {
    return [
      '# Output format guide',
      '',
      '- Preserve the markdown structure of the captured output.',
      '- Preserve heading hierarchy, table layout, bullet lists, and spacing when present.',
      '- Keep section order and presentation logic unchanged.',
      '- Update the content with current evidence instead of copying source facts.',
      '',
      '## Reference',
      '',
      sourceOutput,
    ].join('\n');
  }

  private async buildOutputFormatGuide(sourceOutput: string): Promise<{
    guide: string | null;
    promptTrace: Array<{ stage: string; model: string; prompt: string }>;
  }> {
    const text = (sourceOutput || '').trim();
    if (!text) {
      return { guide: null, promptTrace: [] };
    }

    const httpClient = this.liteLLMConnectionService.getHttpClient();
    if (!httpClient) {
      return { guide: this.getFallbackGuide(text), promptTrace: [] };
    }

    const defaultModel = await this.modelsService.getDefaultModel();
    const model = defaultModel?.id || defaultModel?.litellmModel || '';
    if (!model) {
      return { guide: this.getFallbackGuide(text), promptTrace: [] };
    }

    const userPrompt = `<result_to_describe>\n${text}\n</result_to_describe>`;
    const promptTrace = [{
      stage: 'output_format_guide_generation',
      model,
      prompt: `[SYSTEM]\n${OUTPUT_FORMAT_GUIDE_SYSTEM_PROMPT}\n\n[USER]\n${userPrompt}`,
    }];

    try {
      const response = await httpClient.post('/v1/chat/completions', {
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: OUTPUT_FORMAT_GUIDE_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
      }, {
        timeout: OUTPUT_FORMAT_GUIDE_TIMEOUT_MS,
      });

      const generatedGuide = this.extractChatCompletionText(response.data);
      return {
        guide: generatedGuide || this.getFallbackGuide(text),
        promptTrace,
      };
    } catch (error) {
      this.logger.warn('Failed to generate output format guide, using fallback', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { guide: this.getFallbackGuide(text), promptTrace };
    }
  }

  private mapTemplateToResponse(template: any) {
    return {
      id: (template._id || template.id).toString(),
      playbookId: template.playbookId.toString(),
      taskId: template.taskId,
      sourceExecutionId: template.sourceExecutionId.toString(),
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

  private async emitTemplateUpdated(template: PlaybookOutputFormatTemplateDocument) {
    this.streamGateway.sendToUser(template.createdBy.toString(), {
      type: 'playbook_output_format_template_updated',
      data: {
        playbookId: template.playbookId.toString(),
        taskId: template.taskId,
        template: this.mapTemplateToResponse(template.toJSON()),
      },
    });
  }

  private enqueueGeneration(templateId: string): void {
    void this.runGeneration(async () => {
      await this.generateInBackground(templateId);
    }).catch((error) => {
      this.logger.warn('Async output-format generation failed', {
        templateId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });
  }

  private async generateInBackground(templateId: string): Promise<void> {
    const template = await this.templateModel.findById(templateId).exec();
    if (!template) {
      return;
    }

    try {
      const generated = await this.buildOutputFormatGuide(template.sourceOutput || '');
      template.formatGuide = generated.guide;
      template.llmPromptTrace = generated.promptTrace;
      template.generationStatus = generated.guide
        ? OutputFormatGenerationStatus.READY
        : OutputFormatGenerationStatus.FAILED;
      template.generationError = generated.guide ? null : 'Empty guide generated';
      await template.save();
      await this.emitTemplateUpdated(template);
    } catch (error) {
      template.generationStatus = OutputFormatGenerationStatus.FAILED;
      template.generationError = error instanceof Error ? error.message : 'Unknown error';
      await template.save();
      await this.emitTemplateUpdated(template);
      throw error;
    }
  }

  async captureFromExecution(userId: string, playbookId: string, taskId: string, executionId: string) {
    const execution = await this.executionModel.findById(executionId).lean().exec();
    if (!execution || execution.playbookId.toString() !== playbookId) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND, 'Execution not found');
    }

    const taskResult = (execution.taskResults || []).find((item: any) => item.taskId === taskId);
    if (!taskResult || taskResult.status !== StepStatus.COMPLETED || !taskResult.output) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Completed step output is required to capture an output format');
    }

    const version = (await this.templateModel.countDocuments({
      playbookId: new Types.ObjectId(playbookId),
      taskId,
    })) + 1;

    await this.templateModel.updateMany(
      {
        playbookId: new Types.ObjectId(playbookId),
        taskId,
        status: { $in: [OutputFormatTemplateStatus.ACTIVE, OutputFormatTemplateStatus.INACTIVE] },
      },
      { $set: { status: OutputFormatTemplateStatus.INACTIVE } },
    );

    const template = await this.templateModel.create({
      playbookId: new Types.ObjectId(playbookId),
      taskId,
      createdBy: new Types.ObjectId(userId),
      sourceExecutionId: new Types.ObjectId(executionId),
      sourceExecutionNumber: execution.executionNumber,
      templateVersion: version,
      status: OutputFormatTemplateStatus.ACTIVE,
      generationStatus: OutputFormatGenerationStatus.PENDING,
      generationError: null,
      sourceOutput: taskResult.output,
      formatGuide: null,
      llmPromptTrace: [],
    });

    this.enqueueGeneration(template._id.toString());

    return this.mapTemplateToResponse(template.toJSON());
  }

  async getActiveTemplate(playbookId: string, taskId: string) {
    const template = await this.templateModel.findOne({
      playbookId: new Types.ObjectId(playbookId),
      taskId,
      status: OutputFormatTemplateStatus.ACTIVE,
    }).lean().exec();

    return template ? this.mapTemplateToResponse(template) : null;
  }

  async updateActiveTemplate(playbookId: string, taskId: string, dto: UpdateOutputFormatTemplateDto) {
    const template = await this.templateModel.findOne({
      playbookId: new Types.ObjectId(playbookId),
      taskId,
      status: OutputFormatTemplateStatus.ACTIVE,
    }).exec();

    if (!template) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_NOT_FOUND, 'Active output format template not found');
    }

    if (dto.formatGuide !== undefined) {
      const normalizedGuide = dto.formatGuide.trim();
      template.formatGuide = normalizedGuide || null;
      template.generationStatus = normalizedGuide
        ? OutputFormatGenerationStatus.READY
        : OutputFormatGenerationStatus.FAILED;
      template.generationError = normalizedGuide ? null : 'Empty format guide';
    }

    await template.save();
    await this.emitTemplateUpdated(template);
    return this.mapTemplateToResponse(template.toJSON());
  }

  async getActiveTemplates(playbookId: string, taskIds: string[]) {
    if (taskIds.length === 0) {
      return new Map<string, any>();
    }
    const templates = await this.templateModel.find({
      playbookId: new Types.ObjectId(playbookId),
      taskId: { $in: taskIds },
      status: OutputFormatTemplateStatus.ACTIVE,
    }).lean().exec();

    const result = new Map<string, any>();
    for (const template of templates) {
      result.set(template.taskId, this.mapTemplateToResponse(template));
    }
    return result;
  }
}

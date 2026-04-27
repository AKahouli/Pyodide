import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PlaybookPromptTemplate,
  PlaybookPromptTemplateDocument,
} from '../schemas/playbook-prompt-template.schema';
import {
  PlaybookPromptTemplateListResponse,
  PlaybookPromptTemplateResponse,
  UpsertPlaybookPromptTemplateRequest,
} from '../interfaces/playbook-prompt.interface';

type PromptDefaultsEntry = Pick<PlaybookPromptTemplateResponse, 'key' | 'title' | 'category' | 'description' | 'systemTemplate' | 'userTemplate' | 'enabled' | 'isBuiltIn'>;

const DEFAULT_PROMPTS: PromptDefaultsEntry[] = [
  {
    key: 'playbook.generate',
    title: 'Playbook generation preprompt',
    category: 'design',
    description: 'System preprompt used by the playbook autobuilder before the DAG instructions.',
    systemTemplate: 'You are an expert playbook architect. Produce a valid, actionable DAG that respects the user request and the available agents.',
    userTemplate: '',
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'design.max_description_length',
    title: 'Max description length',
    category: 'design',
    description: 'Maximum allowed length for playbook and task descriptions. Set the value in systemTemplate (numeric string).',
    systemTemplate: '20000',
    userTemplate: '',
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'task.system',
    title: 'Task system prompt',
    category: 'task',
    description: 'Base system prompt for every playbook task execution.',
    systemTemplate: 'You are {{agentName}}.\n\nYour instructions:\n{{agentInstructions}}\n\nYou are working on a task as part of a playbook execution.',
    userTemplate: '',
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'task.user.footer',
    title: 'Task user footer',
    category: 'task',
    description: 'Footer appended to task prompts before completion.',
    systemTemplate: '',
    userTemplate: 'Please complete this task and provide a clear output.',
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'task.output_ports.note',
    title: 'Task output port note',
    category: 'task',
    description: 'Semantic instruction block for declared output ports.',
    systemTemplate: '',
    userTemplate: 'Declared output ports are semantic targets. When multiple ports share a kind, use the port name and description to decide the right target. If you produce structured outputs, set `output_port_id` to a declared id.',
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'task.clarification',
    title: 'Clarification prompt',
    category: 'task',
    description: 'Fallback clarification prompt when a task asks for more information.',
    systemTemplate: 'Review the task below and determine if you have enough information to complete it. If you need clarification, respond with one clear question only. If everything is clear, respond with exactly \'CLEAR\'.',
    userTemplate: '',
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'replay.final_synthesis',
    title: 'Replay final synthesis',
    category: 'replay',
    description: 'Prompt for replay flex/adaptive final synthesis.',
    systemTemplate: 'You are {{agentName}}.\n\nYour instructions:\n{{agentInstructions}}\n\nYou are working on a task as part of a playbook execution.',
    userTemplate: 'Use the following replayed tool execution results to produce the final answer.\n\n{{synthesisContext}}',
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'replay.adaptive_tool_args',
    title: 'Adaptive replay tool args',
    category: 'replay',
    description: 'Prompt for rewriting tool arguments during adaptive replay.',
    systemTemplate: 'You rewrite tool arguments for adaptive replay. Keep the same tool intent and the same JSON shape. Only change values that are necessary to align with the current task context. Return JSON only.',
    userTemplate: 'Tool name: {{toolName}}\nOriginal args JSON:\n{{originalArgsJson}}\n\nReference task title: {{referenceTaskTitle}}\nReference task description: {{referenceTaskDescription}}\n\nCurrent task title: {{taskTitle}}\nCurrent task description: {{taskDescription}}\nCurrent user query: {{currentQuery}}\nDependency context: {{dependencyContext}}\n\nPrevious replay tool outputs:\n{{previousOutputs}}\n\nReturn the adapted args as JSON with the same top-level keys as the original args.',
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'evaluation.task.system',
    title: 'Evaluation task system prompt',
    category: 'evaluation',
    description: 'System prompt for graph-native playbook evaluation task nodes.',
    systemTemplate: 'You are a strict playbook evaluation judge. Evaluate only the evidence provided through connected inputs and the configured expectation/baseline. Return strict JSON only.',
    userTemplate: '',
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'evaluation.task.user',
    title: 'Evaluation task user prompt',
    category: 'evaluation',
    description: 'User prompt template for graph-native playbook evaluation task nodes.',
    systemTemplate: '',
    userTemplate: 'Evaluation task title: {{taskTitle}}\nEvaluation task description: {{taskDescription}}\n\nExpected result:\n{{expectation}}\n\nReference baseline:\n{{baselineSummary}}\n\nConnected inputs JSON:\n{{inputsJson}}\n\nRubric JSON:\n{{rubricJson}}\n\nReturn JSON with this exact shape:\n{\n  "score": 0,\n  "verdict": "pass|warning|fail",\n  "summary": "",\n  "semanticScore": 0,\n  "referenceScore": 0,\n  "artifactScore": 0,\n  "formatScore": 0,\n  "evidenceScore": 0,\n  "executionHealthScore": 0,\n  "findings": [\n    {\n      "severity": "info|warning|error",\n      "category": "semantic|reference|artifact|format|evidence|execution",\n      "sourceTaskId": "",\n      "message": ""\n    }\n  ]\n}',
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'design.prompt_rewrite',
    title: 'Prompt rewrite system',
    category: 'design',
    description: 'System prompt for playbook prompt rewriting.',
    systemTemplate: 'You rewrite workflow prompts for a playbook builder. Improve clarity, specificity, structure, and actionability while preserving the user\'s intent. Return only the rewritten prompt as plain text, with no preamble, no bullets, and no quotes.',
    userTemplate: '',
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'judge.node_reflection',
    title: 'Playbook Advisor step analysis',
    category: 'judge',
    description: 'System prompt for non-blocking per-step Playbook Advisor analysis, including tool usage quality.',
    systemTemplate: 'You are a strict Playbook Advisor. Evaluate the step output against the task contract, upstream context, produced evidence, tool behavior, and prompt/tool trace quality. Return strict JSON only.',
    userTemplate: 'Task title: {{taskTitle}}\nTask description: {{taskDescription}}\n\nWorkflow goal: {{workflowGoal}}\n\nExpected result source: {{expectedResultSource}}\n\nExpected result:\n{{expectedResult}}\n\nEvaluate whether the task output and artifacts satisfy the expected result semantically. The expected result may be a concrete expected value, a description of how numbers should be presented, a requirement to generate a document or other artifact, a natural-language semantic expectation, or a baseline output from a previous golden execution. Do not require exact text equality unless the expectation is clearly an exact value. If the expected result source is none, return a resultMatchingScore of 0, expectedResultType of none, expectedResultMatched of false, and explain that no expected result was available.\n\nUpstream context JSON:\n{{upstreamContextJson}}\n\nTask output:\n{{taskOutput}}\n\nTask artifacts JSON:\n{{artifactsJson}}\n\nTool trace JSON:\n{{toolTraceJson}}\n\nPrompt trace JSON:\n{{promptTraceJson}}\n\nReturn JSON with this exact shape:\n{\n  "accuracyScore": 0,\n  "completenessScore": 0,\n  "resultMatchingScore": 0,\n  "overallScore": 0,\n  "confidence": 0,\n  "toolUsageScore": 0,\n  "expectedResultSource": "node_field|golden_baseline|none",\n  "expectedResultType": "exact_value|semantic_description|numeric_presentation|document_generation|baseline_comparison|none",\n  "expectedResultMatched": false,\n  "expectedResultReason": "",\n  "missingFacts": [],\n  "incoherences": [],\n  "unsupportedClaims": [],\n  "handoffRisks": [],\n  "rewriteHints": [],\n  "toolSelectionIssues": [],\n  "missingToolCalls": [],\n  "redundantToolCalls": [],\n  "toolOutputUseIssues": [],\n  "toolSequencingIssues": [],\n  "toolUsageStrengths": [],\n  "toolUsageRecommendation": "",\n  "safeAutoFixType": "optimize_step|none",\n  "recommendation": "none|update_current_playbook|generate_new_optimized_playbook",\n  "reason": ""\n}',
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'judge.execution_summary',
    title: 'Playbook Advisor execution summary',
    category: 'judge',
    description: 'System prompt for aggregating step-level Playbook Advisor findings into a workflow-level recommendation.',
    systemTemplate: 'You aggregate Playbook Advisor findings for a playbook execution. Focus on workflow coherence, structural issues, repeated tool misuse, root-cause steps, and the highest-impact optimization recommendations. Return strict JSON only.',
    userTemplate: 'Workflow goal: {{workflowGoal}}\n\nExecution summary JSON:\n{{executionSummaryJson}}\n\nPlaybook Advisor findings JSON:\n{{nodeFindingsJson}}\n\nReturn JSON with this exact shape:\n{\n  "overallScore": 0,\n  "confidence": 0,\n  "structuralIssues": [],\n  "promptIssues": [],\n  "contractIssues": [],\n  "handoffIssues": [],\n  "toolUsageIssues": [],\n  "crossStepToolPatterns": [],\n  "rootCauseTaskIds": [],\n  "highImpactRecommendations": [],\n  "recommendation": "update_current_playbook|generate_new_optimized_playbook",\n  "reason": ""\n}',
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'judge.rewrite_current_playbook',
    title: 'Advisor rewrite current playbook',
    category: 'judge',
    description: 'Prompt for directly updating the current playbook from Playbook Advisor feedback.',
    systemTemplate: 'You rewrite the current playbook in place. Preserve the workflow intent, tighten task wording, improve descriptions, and refine output contracts. Return strict JSON only.',
    userTemplate: 'Original playbook JSON:\n{{playbookJson}}\n\nJudge summary JSON:\n{{judgeSummaryJson}}\n\nReturn JSON with this exact shape:\n{\n  "name": "",\n  "description": "",\n  "tasks": [],\n  "edges": []\n}',
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'judge.generate_optimized_playbook',
    title: 'Advisor generate optimized playbook',
    category: 'judge',
    description: 'Prompt for generating a new optimized playbook from Playbook Advisor feedback.',
    systemTemplate: 'You generate a brand-new optimized playbook from the original playbook and judge findings. Preserve document/data-source input mappings whenever possible. Return strict JSON only.',
    userTemplate: 'Original playbook JSON:\n{{playbookJson}}\n\nJudge summary JSON:\n{{judgeSummaryJson}}\n\nReturn JSON with this exact shape:\n{\n  "name": "",\n  "description": "",\n  "tasks": [],\n  "edges": [],\n  "workspaces": []\n}',
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'judge.optimize_step',
    title: 'Advisor optimize playbook step',
    category: 'judge',
    description: 'Prompt for optimizing a single playbook step from Playbook Advisor feedback while preserving the workflow graph.',
    systemTemplate: 'You optimize a single playbook step in place. Preserve the workflow graph, preserve the step id, and keep document/data-source input mappings intact. Improve the step contract, wording, and actionability. Return strict JSON only.',
    userTemplate: 'Original playbook JSON:\n{{playbookJson}}\n\nSelected task JSON:\n{{taskJson}}\n\nJudge summary JSON:\n{{judgeSummaryJson}}\n\nNode reflection JSON:\n{{judgeResultJson}}\n\nUpstream context JSON:\n{{upstreamContextJson}}\n\nReturn JSON with this exact shape:\n{\n  "task": {\n    "id": "",\n    "title": "",\n    "description": "",\n    "assignedAgentId": null,\n    "executionOrder": 0,\n    "positionX": 0,\n    "positionY": 0,\n    "interruptBefore": false,\n    "interruptAfter": false,\n    "allowClarification": false,\n    "clarificationPrompt": "",\n    "maxClarifications": 3,\n    "inputKeys": [],\n    "outputKey": "",\n    "enabled": true,\n    "notifyOnComplete": false,\n    "notifyEmails": [],\n    "stepReplayMode": "live",\n    "inputFiles": [],\n    "taskType": "generic",\n    "inputPorts": [],\n    "outputPorts": []\n  }\n}',
    enabled: true,
    isBuiltIn: true,
  },
];

@Injectable()
export class PlaybookPromptService {
  private cachedPayload: Record<string, string> | null = null;
  private cachedItems: PlaybookPromptTemplateResponse[] | null = null;
  private cachedAt = 0;
  private static readonly CACHE_TTL_MS = 30_000;

  constructor(
    @InjectModel(PlaybookPromptTemplate.name)
    private readonly promptModel: Model<PlaybookPromptTemplateDocument>,
  ) { }

  private toResponse(doc: PlaybookPromptTemplateDocument | PlaybookPromptTemplate): PlaybookPromptTemplateResponse {
    return {
      id: doc._id.toString(),
      key: doc.key,
      title: doc.title,
      category: doc.category,
      description: doc.description,
      systemTemplate: doc.systemTemplate || '',
      userTemplate: doc.userTemplate || '',
      enabled: doc.enabled,
      version: doc.version,
      isBuiltIn: doc.isBuiltIn,
      createdAt: doc.createdAt?.toISOString?.() || new Date().toISOString(),
      updatedAt: doc.updatedAt?.toISOString?.() || new Date().toISOString(),
    };
  }

  private invalidateCache(): void {
    this.cachedPayload = null;
    this.cachedItems = null;
    this.cachedAt = 0;
  }

  private async seedDefaultsIfNeeded(): Promise<void> {
    const existing = await this.promptModel.find({ key: { $in: DEFAULT_PROMPTS.map((item) => item.key) } }).select('key').lean().exec();
    const existingKeys = new Set(existing.map((item) => item.key));
    const missing = DEFAULT_PROMPTS.filter((item) => !existingKeys.has(item.key));
    if (!missing.length) return;

    await this.promptModel.insertMany(
      missing.map((item) => ({
        ...item,
        version: 1,
        createdBy: null,
        updatedBy: null,
      })),
      { ordered: false },
    );
    this.invalidateCache();
  }

  async findAll(): Promise<PlaybookPromptTemplateListResponse> {
    await this.seedDefaultsIfNeeded();
    const now = Date.now();
    if (this.cachedItems && now - this.cachedAt < PlaybookPromptService.CACHE_TTL_MS) {
      return { items: this.cachedItems };
    }

    const docs = await this.promptModel.find({}).sort({ category: 1, title: 1 }).exec();
    const items = docs.map((doc) => this.toResponse(doc));
    this.cachedItems = items;
    this.cachedAt = now;
    return { items };
  }

  async findByKey(key: string): Promise<PlaybookPromptTemplateResponse | null> {
    await this.seedDefaultsIfNeeded();
    const doc = await this.promptModel.findOne({ key }).exec();
    return doc ? this.toResponse(doc) : null;
  }

  async upsert(
    key: string,
    dto: UpsertPlaybookPromptTemplateRequest,
    userId: string,
  ): Promise<PlaybookPromptTemplateResponse> {
    await this.seedDefaultsIfNeeded();
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) {
      throw new Error('Prompt key is required');
    }

    const existing = await this.promptModel.findOne({ key: normalizedKey }).exec();
    const nextVersion = (existing?.version || 0) + 1;
    const payload = {
      key: normalizedKey,
      title: dto.title.trim(),
      category: dto.category.trim(),
      description: dto.description?.trim() || '',
      systemTemplate: dto.systemTemplate ?? existing?.systemTemplate ?? '',
      userTemplate: dto.userTemplate ?? existing?.userTemplate ?? '',
      enabled: dto.enabled ?? existing?.enabled ?? true,
      version: nextVersion,
      isBuiltIn: existing?.isBuiltIn ?? false,
      updatedBy: new Types.ObjectId(userId),
      createdBy: existing?.createdBy ?? new Types.ObjectId(userId),
    };

    const updated = await this.promptModel.findOneAndUpdate(
      { key: normalizedKey },
      { $set: payload },
      { new: true, upsert: true },
    ).exec();

    this.invalidateCache();
    return this.toResponse(updated);
  }

  async getPromptOverridesPayload(): Promise<Record<string, string>> {
    await this.seedDefaultsIfNeeded();
    const now = Date.now();
    if (this.cachedPayload && now - this.cachedAt < PlaybookPromptService.CACHE_TTL_MS) {
      return this.cachedPayload;
    }

    const docs = await this.promptModel.find({ enabled: true }).exec();
    const payload = docs.reduce<Record<string, string>>((acc, doc) => {
      acc[doc.key] = JSON.stringify(this.toResponse(doc));
      return acc;
    }, {});
    this.cachedPayload = payload;
    this.cachedAt = now;
    return payload;
  }

  async resetCache(): Promise<void> {
    this.invalidateCache();
  }

  getDefaultPromptKeys(): string[] {
    return DEFAULT_PROMPTS.map((item) => item.key);
  }
}

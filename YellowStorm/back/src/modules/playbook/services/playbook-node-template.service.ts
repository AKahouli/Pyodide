import { Injectable, NotFoundException, ConflictException, BadRequestException, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PlaybookNodeTemplate,
  PlaybookNodeTemplateDocument,
} from '../schemas/playbook-node-template.schema';
import {
  PlaybookNodeTemplateListResponse,
  PlaybookNodeTemplateResponse,
  CreatePlaybookNodeTemplateRequest,
  UpdatePlaybookNodeTemplateRequest,
} from '../interfaces/playbook-node-template.interface';

type NodeTemplateDefaultsEntry = Pick<
  PlaybookNodeTemplateResponse,
  | 'key'
  | 'type'
  | 'nodeType'
  | 'title'
  | 'description'
  | 'icon'
  | 'color'
  | 'category'
  | 'inputPorts'
  | 'outputPorts'
  | 'promptTemplate'
  | 'recommendedAgentTypeSlug'
  | 'requiredToolNames'
  | 'iteratorConfig'
  | 'enabled'
  | 'isBuiltIn'
>;

const DEFAULT_NODE_TEMPLATES: NodeTemplateDefaultsEntry[] = [];

const INITIAL_NODE_TEMPLATES: NodeTemplateDefaultsEntry[] = [
  {
    key: 'node_template_document_extractor',
    type: 'document-extractor',
    nodeType: 'agent',
    title: 'Document Extractor',
    description:
      'Extracts structured text content from uploaded documents such as PowerPoint presentations, PDFs, Word files, and other office formats. ' +
      'Parses slides, sections, tables, and embedded text to produce a clean, machine-readable text output ready for downstream summarization, analysis, or enrichment steps.',
    icon: 'FileSearch',
    color: 'blue',
    category: 'content',
    inputPorts: [
      { id: 'document', name: 'Document', artifactKind: 'document', required: true },
    ],
    outputPorts: [
      { id: 'extracted_text', name: 'Extracted Text', artifactKind: 'text' },
    ],
    promptTemplate:
      'Extract all meaningful text content from the provided document. ' +
      'Preserve structural hierarchy where possible and return clean, well-formatted text ready for downstream processing.\n\n{{document}}',
    recommendedAgentTypeSlug: null,
    requiredToolNames: [],
    iteratorConfig: null,
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'node_template_translator',
    type: 'translator',
    nodeType: 'agent',
    title: 'Translator',
    description:
      'Translates text content from a source language to one or more target languages while preserving formatting, tone, and meaning. ' +
      'Useful for localizing reports, emails, documentation, and user-facing content across multilingual workflows.',
    icon: 'Languages',
    color: 'indigo',
    category: 'content',
    inputPorts: [
      { id: 'source_text', name: 'Source Text', artifactKind: 'text', required: true },
      { id: 'target_language', name: 'Target Language', artifactKind: 'text', required: true },
    ],
    outputPorts: [
      { id: 'translated_text', name: 'Translated Text', artifactKind: 'text' },
    ],
    promptTemplate:
      'Translate the following source text into the target language. ' +
      'Preserve the original formatting, tone, and intent. Return only the translated text.\n\nSource text:\n{{source_text}}\n\nTarget language: {{target_language}}',
    recommendedAgentTypeSlug: null,
    requiredToolNames: [],
    iteratorConfig: null,
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'node_template_excel_generator',
    type: 'excel-generator',
    nodeType: 'agent',
    title: 'Excel Generator',
    description:
      'Generates a structured Excel spreadsheet from provided data inputs. ' +
      'Supports multi-sheet workbooks, formatted headers, data validation rules, pivot-ready layouts, and optional template-based styling. ' +
      'Ideal for producing trackers, dashboards, reports, and data exports that business users can open and manipulate directly.',
    icon: 'FileSpreadsheet',
    color: 'green',
    category: 'generation',
    inputPorts: [
      { id: 'data_input', name: 'Data Input', artifactKind: 'data', required: true },
      { id: 'template', name: 'Template', artifactKind: 'document', required: false },
    ],
    outputPorts: [
      { id: 'file', name: 'Excel File', artifactKind: 'document' },
    ],
    promptTemplate:
      'Generate a well-structured Excel spreadsheet from the provided data. ' +
      'Use clear column headers, appropriate data types, and formatting. ' +
      'If a template is provided, follow its layout and styling.\n\n{{data_input}}',
    recommendedAgentTypeSlug: null,
    requiredToolNames: [],
    iteratorConfig: null,
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'node_template_report_generator',
    type: 'report-generator',
    nodeType: 'agent',
    title: 'Report Generator',
    description:
      'Produces a professional document report from structured findings and optional supporting data. ' +
      'Generates executive summaries, detailed analysis sections, charts, tables, and actionable recommendations. ' +
      'Suitable for due diligence reports, market analyses, audit summaries, and stakeholder deliverables.',
    icon: 'FileType',
    color: 'orange',
    category: 'generation',
    inputPorts: [
      { id: 'findings', name: 'Findings', artifactKind: 'text', required: true },
      { id: 'data', name: 'Supporting Data', artifactKind: 'data', required: false },
    ],
    outputPorts: [
      { id: 'report', name: 'Report Document', artifactKind: 'document' },
    ],
    promptTemplate:
      'Produce a professional report from the provided findings and data. ' +
      'Include an executive summary, detailed analysis sections, supporting charts or tables where data is provided, and clear recommendations. ' +
      'Use a polished, business-appropriate tone.\n\nFindings:\n{{findings}}\n\nData:\n{{data}}',
    recommendedAgentTypeSlug: null,
    requiredToolNames: [],
    iteratorConfig: null,
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'node_template_slide_generator',
    type: 'slide-generator',
    nodeType: 'agent',
    title: 'Slide Generator',
    description:
      'Creates presentation slide decks from text content and optional template documents. ' +
      'Generates title slides, section dividers, content slides with bullet points, charts, and speaker notes. ' +
      'Suitable for pitch decks, status updates, training materials, and executive briefings.',
    icon: 'Presentation',
    color: 'rose',
    category: 'generation',
    inputPorts: [
      { id: 'content', name: 'Content', artifactKind: 'text', required: true },
      { id: 'template', name: 'Template', artifactKind: 'document', required: false },
    ],
    outputPorts: [
      { id: 'slides', name: 'Slide Deck', artifactKind: 'document' },
      { id: 'speaker_notes', name: 'Speaker Notes', artifactKind: 'text' },
    ],
    promptTemplate:
      'Create a professional slide deck based on the provided content. ' +
      'Structure slides with clear titles, bullet points, and speaker notes. ' +
      'If a template is provided, follow its layout and branding.\n\n{{content}}',
    recommendedAgentTypeSlug: null,
    requiredToolNames: [],
    iteratorConfig: null,
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'node_template_data_analyzer',
    type: 'data-analyzer',
    nodeType: 'agent',
    title: 'Data Analyzer',
    description:
      'Analyzes structured data to extract insights, identify trends, detect anomalies, and produce a dashboard-ready summary. ' +
      'Performs statistical analysis, pattern recognition, comparative benchmarking, and generates actionable business recommendations.',
    icon: 'BarChart3',
    color: 'purple',
    category: 'analysis',
    inputPorts: [
      { id: 'data', name: 'Data', artifactKind: 'data', required: true },
      { id: 'context', name: 'Context', artifactKind: 'text', required: false },
    ],
    outputPorts: [
      { id: 'insights', name: 'Insights', artifactKind: 'text' },
      { id: 'dashboard', name: 'Dashboard', artifactKind: 'dashboard' },
    ],
    promptTemplate:
      'Analyze the provided data and extract key insights, trends, and patterns. ' +
      'Provide actionable recommendations. If context is provided, frame the analysis around that business context.\n\nData:\n{{data}}\n\nContext:\n{{context}}',
    recommendedAgentTypeSlug: null,
    requiredToolNames: [],
    iteratorConfig: null,
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'node_template_classifier',
    type: 'classifier',
    nodeType: 'agent',
    title: 'Classifier',
    description:
      'Classifies items from a structured dataset into predefined or inferred categories. ' +
      'Useful for triaging incoming requests, routing documents to the correct team, labeling support tickets, categorizing leads, and sentiment analysis.',
    icon: 'Tag',
    color: 'amber',
    category: 'analysis',
    inputPorts: [
      { id: 'items', name: 'Items', artifactKind: 'data', required: true },
      { id: 'categories', name: 'Categories', artifactKind: 'text', required: false },
    ],
    outputPorts: [
      { id: 'classified', name: 'Classified Items', artifactKind: 'data' },
    ],
    promptTemplate:
      'Classify each provided item into an appropriate category. ' +
      'Return the items with their assigned categories and a confidence level. ' +
      'If categories are specified, use only those categories.\n\nItems:\n{{items}}\n\nCategories:\n{{categories}}',
    recommendedAgentTypeSlug: null,
    requiredToolNames: [],
    iteratorConfig: null,
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'node_template_code_generator',
    type: 'code-generator',
    nodeType: 'agent',
    title: 'Code Generator',
    description:
      'Generates production-ready code from a specification, with optional awareness of existing code context. ' +
      'Follows best practices, includes error handling, and produces well-commented output. ' +
      'Suitable for generating scripts, data transformations, API integrations, and automation routines.',
    icon: 'Code',
    color: 'cyan',
    category: 'code',
    inputPorts: [
      { id: 'spec', name: 'Specification', artifactKind: 'text', required: true },
      { id: 'existing_code', name: 'Existing Code', artifactKind: 'code', required: false },
    ],
    outputPorts: [
      { id: 'code', name: 'Generated Code', artifactKind: 'code' },
      { id: 'explanation', name: 'Explanation', artifactKind: 'text' },
    ],
    promptTemplate:
      'Generate production-ready code based on the following specification. ' +
      'Follow best practices, include error handling, and add inline comments. ' +
      'If existing code is provided, integrate with or adapt the existing patterns.\n\nSpecification:\n{{spec}}\n\nExisting Code:\n{{existing_code}}',
    recommendedAgentTypeSlug: null,
    requiredToolNames: [],
    iteratorConfig: null,
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'node_template_code_interpreter',
    type: 'code-interpreter',
    nodeType: 'agent',
    title: 'Code Interpreter',
    description:
      'Executes code against provided input data and returns the computed output along with execution logs. ' +
      'Supports ad-hoc data transformations, calculations, format conversions, validation checks, and programmatic data processing. ' +
      'Useful as a flexible transformation step between data producers and consumers.',
    icon: 'Terminal',
    color: 'teal',
    category: 'code',
    inputPorts: [
      { id: 'code', name: 'Code', artifactKind: 'code', required: true },
      { id: 'input_data', name: 'Input Data', artifactKind: 'data', required: false },
    ],
    outputPorts: [
      { id: 'output', name: 'Output', artifactKind: 'data' },
      { id: 'logs', name: 'Execution Logs', artifactKind: 'text' },
    ],
    promptTemplate:
      'Execute the provided code against the input data. ' +
      'Return the computed output and any execution logs or errors.\n\nCode:\n{{code}}\n\nInput Data:\n{{input_data}}',
    recommendedAgentTypeSlug: null,
    requiredToolNames: [],
    iteratorConfig: null,
    enabled: true,
    isBuiltIn: true,
  },
  {
    key: 'node_template_web_researcher',
    type: 'web-researcher',
    nodeType: 'agent',
    title: 'Web Researcher',
    description:
      'Researches a topic or query using web search and returns structured findings with source citations. ' +
      'Suitable for market research, competitive analysis, lead sourcing, fact-checking, due diligence, and gathering publicly available information.',
    icon: 'Globe',
    color: 'emerald',
    category: 'enrichment',
    inputPorts: [
      { id: 'query', name: 'Query', artifactKind: 'text', required: true },
      { id: 'context', name: 'Context', artifactKind: 'text', required: false },
    ],
    outputPorts: [
      { id: 'findings', name: 'Findings', artifactKind: 'text' },
      { id: 'sources', name: 'Sources', artifactKind: 'data' },
    ],
    promptTemplate:
      'Research the following query thoroughly using web search. ' +
      'Return well-organized findings with clear source citations. ' +
      'If context is provided, focus the research on relevant aspects.\n\nQuery:\n{{query}}\n\nContext:\n{{context}}',
    recommendedAgentTypeSlug: null,
    requiredToolNames: [],
    iteratorConfig: null,
    enabled: true,
    isBuiltIn: true,
  },
];

@Injectable()
export class PlaybookNodeTemplateService implements OnApplicationBootstrap {
  private cachedItems: PlaybookNodeTemplateResponse[] | null = null;
  private cachedAt = 0;
  private static readonly CACHE_TTL_MS = 30_000;

  constructor(
    @InjectModel(PlaybookNodeTemplate.name)
    private readonly templateModel: Model<PlaybookNodeTemplateDocument>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const count = await this.templateModel.countDocuments({}).exec();
    if (count > 0) return;

    await this.templateModel.insertMany(
      INITIAL_NODE_TEMPLATES.map((item) => ({
        ...item,
        version: 1,
        createdBy: null,
        updatedBy: null,
      })),
      { ordered: false },
    );
    this.invalidateCache();
  }

  private deriveNodeType(doc: Pick<PlaybookNodeTemplate, 'nodeType' | 'type' | 'executionMode'>): PlaybookNodeTemplateResponse['nodeType'] {
    if (doc.nodeType) {
      return doc.nodeType;
    }
    if (doc.type === 'iterator') {
      return 'iterator';
    }
    if (doc.type === 'evaluation') {
      return 'evaluation';
    }
    if (doc.executionMode === 'action') {
      return 'action';
    }
    return 'agent';
  }

  private toResponse(doc: PlaybookNodeTemplateDocument | PlaybookNodeTemplate): PlaybookNodeTemplateResponse {
    return {
      id: doc._id.toString(),
      key: doc.key,
      type: doc.type,
      nodeType: this.deriveNodeType(doc),
      title: doc.title,
      description: doc.description,
      icon: doc.icon,
      color: doc.color,
      category: doc.category,
      inputPorts: doc.inputPorts || [],
      outputPorts: doc.outputPorts || [],
      promptTemplate: doc.promptTemplate || '',
      recommendedAgentTypeSlug: doc.recommendedAgentTypeSlug ?? null,
      requiredToolNames: doc.requiredToolNames || [],
      executionMode: doc.executionMode || 'agent',
      assignedAgentId: doc.assignedAgentId ?? null,
      selectedAction: doc.selectedAction ?? null,
      iteratorConfig: doc.iteratorConfig ?? null,
      enabled: doc.enabled,
      version: doc.version,
      isBuiltIn: doc.isBuiltIn,
      createdAt: doc.createdAt?.toISOString?.() || new Date().toISOString(),
      updatedAt: doc.updatedAt?.toISOString?.() || new Date().toISOString(),
    };
  }

  private invalidateCache(): void {
    this.cachedItems = null;
    this.cachedAt = 0;
  }

  private async seedDefaultsIfNeeded(): Promise<void> {
    const existing = await this.templateModel
      .find({
        $or: [
          { key: { $in: DEFAULT_NODE_TEMPLATES.map((item) => item.key) } },
          { type: { $in: DEFAULT_NODE_TEMPLATES.map((item) => item.type) } },
        ],
      })
      .select('_id key type isBuiltIn enabled')
      .lean()
      .exec();

    const missing = DEFAULT_NODE_TEMPLATES.filter((item) => {
      const matches = existing.filter((existingItem) => existingItem.key === item.key || existingItem.type === item.type);
      return matches.length === 0;
    });

    if (missing.length) {
      await this.templateModel.insertMany(
        missing.map((item) => ({
          ...item,
          version: 1,
          createdBy: null,
          updatedBy: null,
        })),
        { ordered: false },
      );
    }

    if (missing.length) {
      this.invalidateCache();
    }
  }

  async findAll(): Promise<PlaybookNodeTemplateListResponse> {
    await this.seedDefaultsIfNeeded();
    const now = Date.now();
    if (this.cachedItems && now - this.cachedAt < PlaybookNodeTemplateService.CACHE_TTL_MS) {
      return { items: this.cachedItems };
    }

    const docs = await this.templateModel.find({}).sort({ category: 1, title: 1 }).exec();
    const items = docs.map((doc) => this.toResponse(doc));
    this.cachedItems = items;
    this.cachedAt = now;
    return { items };
  }

  async findEnabled(): Promise<PlaybookNodeTemplateListResponse> {
    await this.seedDefaultsIfNeeded();
    const docs = await this.templateModel
      .find({ enabled: true })
      .sort({ category: 1, title: 1 })
      .exec();
    return { items: docs.map((doc) => this.toResponse(doc)) };
  }

  async findById(id: string): Promise<PlaybookNodeTemplateResponse | null> {
    await this.seedDefaultsIfNeeded();
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.templateModel.findById(id).exec();
    return doc ? this.toResponse(doc) : null;
  }

  async create(
    dto: CreatePlaybookNodeTemplateRequest,
    userId: string,
  ): Promise<PlaybookNodeTemplateResponse> {
    await this.seedDefaultsIfNeeded();
    const normalizedKey = String(dto.key || '').trim();
    const normalizedType = String(dto.type || '').trim();

    if (!normalizedKey || !normalizedType) {
      throw new BadRequestException('Key and type are required');
    }

    const existing = await this.templateModel.findOne({
      $or: [{ key: normalizedKey }, { type: normalizedType }],
    }).exec();

    if (existing) {
      throw new ConflictException('A template with this key or type already exists');
    }

    const created = await this.templateModel.create({
      key: normalizedKey,
      type: normalizedType,
      nodeType: dto.nodeType,
      title: dto.title.trim(),
      description: dto.description?.trim() || '',
      icon: dto.icon?.trim() || '',
      color: dto.color?.trim() || '',
      category: dto.category.trim(),
      inputPorts: dto.inputPorts || [],
      outputPorts: dto.outputPorts || [],
      promptTemplate: dto.promptTemplate || '',
      recommendedAgentTypeSlug: dto.recommendedAgentTypeSlug ?? null,
      requiredToolNames: dto.requiredToolNames || [],
      executionMode: dto.executionMode || 'agent',
      assignedAgentId: dto.assignedAgentId ?? null,
      selectedAction: dto.selectedAction ?? null,
      iteratorConfig: dto.iteratorConfig ?? null,
      enabled: dto.enabled ?? true,
      version: 1,
      isBuiltIn: false,
      createdBy: new Types.ObjectId(userId),
      updatedBy: new Types.ObjectId(userId),
    });

    this.invalidateCache();
    return this.toResponse(created);
  }

  async update(
    id: string,
    dto: UpdatePlaybookNodeTemplateRequest,
    userId: string,
  ): Promise<PlaybookNodeTemplateResponse> {
    await this.seedDefaultsIfNeeded();
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid template id');
    }

    const existing = await this.templateModel.findById(id).exec();
    if (!existing) {
      throw new NotFoundException('Template not found');
    }

    if (dto.key || dto.type) {
      const normalizedKey = dto.key ? String(dto.key).trim() : existing.key;
      const normalizedType = dto.type ? String(dto.type).trim() : existing.type;
      const conflict = await this.templateModel.findOne({
        _id: { $ne: new Types.ObjectId(id) },
        $or: [{ key: normalizedKey }, { type: normalizedType }],
      }).exec();
      if (conflict) {
        throw new ConflictException('A template with this key or type already exists');
      }
    }

    const updatePayload: Record<string, unknown> = {
      updatedBy: new Types.ObjectId(userId),
      version: (existing.version || 0) + 1,
    };

    if (dto.key !== undefined) updatePayload.key = dto.key.trim();
    if (dto.type !== undefined) updatePayload.type = dto.type.trim();
    if (dto.nodeType !== undefined) updatePayload.nodeType = dto.nodeType;
    if (dto.title !== undefined) updatePayload.title = dto.title.trim();
    if (dto.description !== undefined) updatePayload.description = dto.description.trim();
    if (dto.icon !== undefined) updatePayload.icon = dto.icon.trim();
    if (dto.color !== undefined) updatePayload.color = dto.color.trim();
    if (dto.category !== undefined) updatePayload.category = dto.category.trim();
    if (dto.inputPorts !== undefined) updatePayload.inputPorts = dto.inputPorts;
    if (dto.outputPorts !== undefined) updatePayload.outputPorts = dto.outputPorts;
    if (dto.promptTemplate !== undefined) updatePayload.promptTemplate = dto.promptTemplate;
    if (dto.recommendedAgentTypeSlug !== undefined) updatePayload.recommendedAgentTypeSlug = dto.recommendedAgentTypeSlug;
    if (dto.requiredToolNames !== undefined) updatePayload.requiredToolNames = dto.requiredToolNames;
    if (dto.executionMode !== undefined) updatePayload.executionMode = dto.executionMode;
    if (dto.assignedAgentId !== undefined) updatePayload.assignedAgentId = dto.assignedAgentId;
    if (dto.selectedAction !== undefined) updatePayload.selectedAction = dto.selectedAction;
    if (dto.iteratorConfig !== undefined) updatePayload.iteratorConfig = dto.iteratorConfig;
    if (dto.enabled !== undefined) updatePayload.enabled = dto.enabled;

    const updated = await this.templateModel.findByIdAndUpdate(id, { $set: updatePayload }, { new: true }).exec();
    if (!updated) {
      throw new NotFoundException('Template not found');
    }

    this.invalidateCache();
    return this.toResponse(updated);
  }

  async delete(id: string): Promise<void> {
    await this.seedDefaultsIfNeeded();
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid template id');
    }

    const existing = await this.templateModel.findById(id).exec();
    if (!existing) {
      throw new NotFoundException('Template not found');
    }

    await this.templateModel.findByIdAndDelete(id).exec();
    this.invalidateCache();
  }

  async resetCache(): Promise<void> {
    this.invalidateCache();
  }

  getDefaultTemplateKeys(): string[] {
    return INITIAL_NODE_TEMPLATES.map((item) => item.key);
  }
}

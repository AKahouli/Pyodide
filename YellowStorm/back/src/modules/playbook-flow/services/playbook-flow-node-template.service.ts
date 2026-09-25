import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { isObjectId, isUniqueViolation } from '@common/postgres';
import {
  FlowNodeTemplateListResponse,
  FlowNodeTemplateImportPayload,
  FlowNodeTemplateResponse,
  CreateFlowNodeTemplateRequest,
  UpdateFlowNodeTemplateRequest,
} from '../interfaces/playbook-flow-node-template.interface';
import {
  NodeTemplateRepository,
  type NewNodeTemplate,
  type NodeTemplateFields,
  type NodeTemplateRecord,
} from '../persistence/node-template.repository';
import { TEMPLATE_MAX_LENGTHS } from '../persistence/template-cast';

const DUPLICATE_KEY = 'A template with this key already exists';

/**
 * The varchar columns refuse what Mongoose's `maxlength` only checked on create (updates and imports
 * stored any length): an over-long value is a 400 instead of a database error.
 */
function assertLengths(fields: Partial<Record<keyof typeof TEMPLATE_MAX_LENGTHS, string | null | undefined>>): void {
  for (const [field, max] of Object.entries(TEMPLATE_MAX_LENGTHS)) {
    const value = fields[field as keyof typeof TEMPLATE_MAX_LENGTHS];
    if (typeof value === 'string' && value.trim().length > max) {
      throw new BadRequestException(`${field} must be at most ${max} characters`);
    }
  }
}

@Injectable()
export class PlaybookFlowNodeTemplateService {
  private cachedItems: FlowNodeTemplateResponse[] | null = null;
  private cachedAt = 0;
  private static readonly CACHE_TTL_MS = 30_000;

  constructor(private readonly templates: NodeTemplateRepository) {}

  private deriveNodeType(record: Pick<NodeTemplateRecord, 'nodeType'>): FlowNodeTemplateResponse['nodeType'] {
    if (record.nodeType) return record.nodeType;
    return 'agent';
  }

  private toResponse(record: NodeTemplateRecord): FlowNodeTemplateResponse {
    return {
      id: record.id,
      key: record.key,
      nodeType: this.deriveNodeType(record),
      title: record.title,
      description: record.description ?? undefined,
      icon: record.icon ?? undefined,
      color: record.color ?? undefined,
      category: record.category,
      inputPorts: record.inputPorts || [],
      outputPorts: record.outputPorts || [],
      promptTemplate: record.promptTemplate || '',
      recommendedAgentTypeSlug: record.recommendedAgentTypeSlug ?? null,
      requiredToolNames: record.requiredToolNames || [],
      assignedAgentId: record.assignedAgentId ?? null,
      selectedAction: record.selectedAction ?? null,
      iteratorConfig: record.iteratorConfig ?? null,
      routerConfig: record.routerConfig ?? null,
      humanApprovalConfig: record.humanApprovalConfig ?? null,
      retryPolicy: record.retryPolicy ?? null,
      modelId: record.modelId ?? null,
      enabled: record.enabled,
      version: record.version,
      isBuiltIn: record.isBuiltIn,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private invalidateCache(): void {
    this.cachedItems = null;
    this.cachedAt = 0;
  }

  async findAll(): Promise<FlowNodeTemplateListResponse> {
    const now = Date.now();
    if (this.cachedItems && now - this.cachedAt < PlaybookFlowNodeTemplateService.CACHE_TTL_MS) {
      return { items: this.cachedItems };
    }
    const records = await this.templates.list();
    const items = records.map((record) => this.toResponse(record));
    this.cachedItems = items;
    this.cachedAt = now;
    return { items };
  }

  async findEnabled(): Promise<FlowNodeTemplateListResponse> {
    const records = await this.templates.list({ enabledOnly: true });
    return { items: records.map((record) => this.toResponse(record)) };
  }

  async findById(id: string): Promise<FlowNodeTemplateResponse | null> {
    if (!isObjectId(id)) return null;
    const record = await this.templates.findById(id);
    return record ? this.toResponse(record) : null;
  }

  async create(dto: CreateFlowNodeTemplateRequest, userId: string): Promise<FlowNodeTemplateResponse> {
    const normalizedKey = String(dto.key || '').trim();
    if (!normalizedKey) throw new BadRequestException('Key is required');

    if (await this.templates.keyTaken(normalizedKey)) throw new ConflictException(DUPLICATE_KEY);

    const input: NewNodeTemplate = {
      key: normalizedKey, nodeType: dto.nodeType,
      title: dto.title.trim(), description: dto.description?.trim() || '',
      icon: dto.icon?.trim() || '', color: dto.color?.trim() || '',
      category: dto.category.trim(), inputPorts: dto.inputPorts || [],
      outputPorts: dto.outputPorts || [], promptTemplate: dto.promptTemplate || '',
      recommendedAgentTypeSlug: dto.recommendedAgentTypeSlug ?? null,
      requiredToolNames: dto.requiredToolNames || [],
      assignedAgentId: dto.assignedAgentId ?? null,
      selectedAction: dto.selectedAction ?? null,
      iteratorConfig: dto.iteratorConfig ?? null,
      routerConfig: dto.routerConfig ?? null,
      humanApprovalConfig: dto.humanApprovalConfig ?? null,
      retryPolicy: dto.retryPolicy ?? null,
      modelId: dto.modelId ?? null,
      enabled: dto.enabled ?? true, version: 1, isBuiltIn: false,
      createdBy: userId, updatedBy: userId,
    };
    assertLengths(input);
    try {
      const created = await this.templates.create(input);
      this.invalidateCache();
      return this.toResponse(created);
    } catch (error) {
      // A concurrent create of the same key lost the race on the unique index.
      if (isUniqueViolation(error, 'uq_playbook_node_templates_key')) throw new ConflictException(DUPLICATE_KEY);
      throw error;
    }
  }

  async update(id: string, dto: UpdateFlowNodeTemplateRequest, userId: string): Promise<FlowNodeTemplateResponse> {
    if (!isObjectId(id)) throw new BadRequestException('Invalid template id');
    const existing = await this.templates.findById(id);
    if (!existing) throw new NotFoundException('Template not found');

    if (dto.key) {
      const normalizedKey = dto.key ? String(dto.key).trim() : existing.key;
      if (await this.templates.keyTaken(normalizedKey, id)) throw new ConflictException(DUPLICATE_KEY);
    }

    const fields: NodeTemplateFields = { updatedBy: userId };
    if (dto.key !== undefined) fields.key = dto.key.trim();
    if (dto.nodeType !== undefined) fields.nodeType = dto.nodeType;
    if (dto.title !== undefined) fields.title = dto.title.trim();
    if (dto.description !== undefined) fields.description = dto.description.trim();
    if (dto.icon !== undefined) fields.icon = dto.icon.trim();
    if (dto.color !== undefined) fields.color = dto.color.trim();
    if (dto.category !== undefined) fields.category = dto.category.trim();
    if (dto.inputPorts !== undefined) fields.inputPorts = dto.inputPorts;
    if (dto.outputPorts !== undefined) fields.outputPorts = dto.outputPorts;
    if (dto.promptTemplate !== undefined) fields.promptTemplate = dto.promptTemplate;
    if (dto.recommendedAgentTypeSlug !== undefined) fields.recommendedAgentTypeSlug = dto.recommendedAgentTypeSlug;
    if (dto.requiredToolNames !== undefined) fields.requiredToolNames = dto.requiredToolNames;
    if (dto.assignedAgentId !== undefined) fields.assignedAgentId = dto.assignedAgentId;
    if (dto.selectedAction !== undefined) fields.selectedAction = dto.selectedAction;
    if (dto.iteratorConfig !== undefined) fields.iteratorConfig = dto.iteratorConfig;
    if (dto.routerConfig !== undefined) fields.routerConfig = dto.routerConfig;
    if (dto.humanApprovalConfig !== undefined) fields.humanApprovalConfig = dto.humanApprovalConfig;
    if (dto.retryPolicy !== undefined) fields.retryPolicy = dto.retryPolicy;
    if (dto.modelId !== undefined) fields.modelId = dto.modelId;
    if (dto.enabled !== undefined) fields.enabled = dto.enabled;
    assertLengths(fields);

    let updated: NodeTemplateRecord | null;
    try {
      updated = await this.templates.update(id, fields);
    } catch (error) {
      if (isUniqueViolation(error, 'uq_playbook_node_templates_key')) throw new ConflictException(DUPLICATE_KEY);
      throw error;
    }
    if (!updated) throw new NotFoundException('Template not found');
    this.invalidateCache();
    return this.toResponse(updated);
  }

  async delete(id: string): Promise<void> {
    if (!isObjectId(id)) throw new BadRequestException('Invalid template id');
    if (!(await this.templates.delete(id))) throw new NotFoundException('Template not found');
    this.invalidateCache();
  }

  async replaceAll(payload: FlowNodeTemplateImportPayload, userId: string): Promise<FlowNodeTemplateListResponse> {
    const keys = payload.items.map((item) => item.key.trim());
    if (keys.some((key) => !key)) throw new BadRequestException('Import contains an empty template key');
    if (new Set(keys).size !== keys.length) throw new BadRequestException('Import contains duplicate template keys');

    const items: NewNodeTemplate[] = payload.items.map((item) => ({
      key: item.key.trim(), nodeType: item.nodeType,
      title: item.title.trim(), description: item.description?.trim() || '',
      icon: item.icon?.trim() || '', color: item.color?.trim() || '',
      category: item.category.trim(), inputPorts: (item.inputPorts || []).map((port) => ({ ...port, required: port.required ?? false })),
      outputPorts: item.outputPorts || [], promptTemplate: item.promptTemplate || '',
      recommendedAgentTypeSlug: item.recommendedAgentTypeSlug ?? null,
      requiredToolNames: item.requiredToolNames || [],
      assignedAgentId: item.assignedAgentId ?? null,
      selectedAction: item.selectedAction ?? null,
      iteratorConfig: item.iteratorConfig ?? null,
      routerConfig: item.routerConfig ?? null,
      humanApprovalConfig: item.humanApprovalConfig ?? null,
      retryPolicy: item.retryPolicy ?? null,
      modelId: item.modelId ?? null,
      enabled: item.enabled ?? true, version: 1, isBuiltIn: item.isBuiltIn ?? false,
      createdBy: userId, updatedBy: userId,
    }));
    items.forEach(assertLengths);

    await this.templates.replaceAll(items);
    this.invalidateCache();
    return this.findAll();
  }

  async resetCache(): Promise<void> {
    this.invalidateCache();
  }
}

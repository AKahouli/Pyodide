import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FlowNodeTemplate, FlowNodeTemplateDocument } from '../schemas/playbook-flow-node-template.schema';
import {
  FlowNodeTemplateListResponse,
  FlowNodeTemplateImportPayload,
  FlowNodeTemplateResponse,
  CreateFlowNodeTemplateRequest,
  UpdateFlowNodeTemplateRequest,
} from '../interfaces/playbook-flow-node-template.interface';

@Injectable()
export class PlaybookFlowNodeTemplateService {
  private cachedItems: FlowNodeTemplateResponse[] | null = null;
  private cachedAt = 0;
  private static readonly CACHE_TTL_MS = 30_000;

  constructor(
    @InjectModel(FlowNodeTemplate.name)
    private readonly templateModel: Model<FlowNodeTemplateDocument>,
  ) {}

  private deriveNodeType(doc: Pick<FlowNodeTemplate, 'nodeType'>): FlowNodeTemplateResponse['nodeType'] {
    if (doc.nodeType) return doc.nodeType;
    return 'agent';
  }

  private toResponse(doc: FlowNodeTemplateDocument | FlowNodeTemplate): FlowNodeTemplateResponse {
    return {
      id: (doc as any)._id.toString(),
      key: doc.key,
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
      assignedAgentId: doc.assignedAgentId ?? null,
      selectedAction: doc.selectedAction ?? null,
      iteratorConfig: doc.iteratorConfig ?? null,
      routerConfig: doc.routerConfig ?? null,
    humanApprovalConfig: doc.humanApprovalConfig ?? null,
    retryPolicy: doc.retryPolicy ?? null,
    modelId: doc.modelId ?? null,
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

  async findAll(): Promise<FlowNodeTemplateListResponse> {
    const now = Date.now();
    if (this.cachedItems && now - this.cachedAt < PlaybookFlowNodeTemplateService.CACHE_TTL_MS) {
      return { items: this.cachedItems };
    }
    const docs = await this.templateModel.find({}).sort({ category: 1, title: 1 }).exec();
    const items = docs.map((doc) => this.toResponse(doc));
    this.cachedItems = items;
    this.cachedAt = now;
    return { items };
  }

  async findEnabled(): Promise<FlowNodeTemplateListResponse> {
    const docs = await this.templateModel.find({ enabled: true }).sort({ category: 1, title: 1 }).exec();
    return { items: docs.map((doc) => this.toResponse(doc)) };
  }

  async findById(id: string): Promise<FlowNodeTemplateResponse | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.templateModel.findById(id).exec();
    return doc ? this.toResponse(doc) : null;
  }

  async create(dto: CreateFlowNodeTemplateRequest, userId: string): Promise<FlowNodeTemplateResponse> {
    const normalizedKey = String(dto.key || '').trim();
    if (!normalizedKey) throw new BadRequestException('Key is required');

    const existing = await this.templateModel.findOne({ key: normalizedKey }).exec();
    if (existing) throw new ConflictException('A template with this key already exists');

    const created = await this.templateModel.create({
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
      createdBy: new Types.ObjectId(userId), updatedBy: new Types.ObjectId(userId),
    });
    this.invalidateCache();
    return this.toResponse(created);
  }

  async update(id: string, dto: UpdateFlowNodeTemplateRequest, userId: string): Promise<FlowNodeTemplateResponse> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid template id');
    const existing = await this.templateModel.findById(id).exec();
    if (!existing) throw new NotFoundException('Template not found');

    if (dto.key) {
      const normalizedKey = dto.key ? String(dto.key).trim() : existing.key;
      const conflict = await this.templateModel.findOne({
        _id: { $ne: new Types.ObjectId(id) },
        key: normalizedKey,
      }).exec();
      if (conflict) throw new ConflictException('A template with this key already exists');
    }

    const updatePayload: Record<string, unknown> = {
      updatedBy: new Types.ObjectId(userId), version: (existing.version || 0) + 1,
    };
    if (dto.key !== undefined) updatePayload.key = dto.key.trim();
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
    if (dto.assignedAgentId !== undefined) updatePayload.assignedAgentId = dto.assignedAgentId;
    if (dto.selectedAction !== undefined) updatePayload.selectedAction = dto.selectedAction;
    if (dto.iteratorConfig !== undefined) updatePayload.iteratorConfig = dto.iteratorConfig;
    if (dto.routerConfig !== undefined) updatePayload.routerConfig = dto.routerConfig;
    if (dto.humanApprovalConfig !== undefined) updatePayload.humanApprovalConfig = dto.humanApprovalConfig;
    if (dto.retryPolicy !== undefined) updatePayload.retryPolicy = dto.retryPolicy;
    if (dto.modelId !== undefined) updatePayload.modelId = dto.modelId;
    if (dto.enabled !== undefined) updatePayload.enabled = dto.enabled;

    const updated = await this.templateModel.findByIdAndUpdate(id, { $set: updatePayload }, { new: true }).exec();
    if (!updated) throw new NotFoundException('Template not found');
    this.invalidateCache();
    return this.toResponse(updated);
  }

  async delete(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid template id');
    const existing = await this.templateModel.findById(id).exec();
    if (!existing) throw new NotFoundException('Template not found');
    await this.templateModel.findByIdAndDelete(id).exec();
    this.invalidateCache();
  }

  async replaceAll(payload: FlowNodeTemplateImportPayload, userId: string): Promise<FlowNodeTemplateListResponse> {
    const keys = payload.items.map((item) => item.key.trim());
    if (keys.some((key) => !key)) throw new BadRequestException('Import contains an empty template key');
    if (new Set(keys).size !== keys.length) throw new BadRequestException('Import contains duplicate template keys');

    const userObjectId = new Types.ObjectId(userId);
    const docs = payload.items.map((item) => ({
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
      createdBy: userObjectId, updatedBy: userObjectId,
    }));

    if (docs.length) {
      await this.templateModel.bulkWrite(docs.map((doc) => ({
        updateOne: {
          filter: { key: doc.key },
          update: { $set: doc },
          upsert: true,
        },
      })), { ordered: true });
    }
    await this.templateModel.deleteMany({ key: { $nin: keys } }).exec();
    this.invalidateCache();
    return this.findAll();
  }

  async resetCache(): Promise<void> {
    this.invalidateCache();
  }
}

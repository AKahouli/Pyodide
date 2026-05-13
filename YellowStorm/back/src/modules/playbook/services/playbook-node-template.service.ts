import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
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

@Injectable()
export class PlaybookNodeTemplateService {
  private cachedItems: PlaybookNodeTemplateResponse[] | null = null;
  private cachedAt = 0;
  private static readonly CACHE_TTL_MS = 30_000;

  constructor(
    @InjectModel(PlaybookNodeTemplate.name)
    private readonly templateModel: Model<PlaybookNodeTemplateDocument>,
  ) {}

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

  async findAll(): Promise<PlaybookNodeTemplateListResponse> {
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
    const docs = await this.templateModel
      .find({ enabled: true })
      .sort({ category: 1, title: 1 })
      .exec();
    return { items: docs.map((doc) => this.toResponse(doc)) };
  }

  async findById(id: string): Promise<PlaybookNodeTemplateResponse | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.templateModel.findById(id).exec();
    return doc ? this.toResponse(doc) : null;
  }

  async create(
    dto: CreatePlaybookNodeTemplateRequest,
    userId: string,
  ): Promise<PlaybookNodeTemplateResponse> {
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

}

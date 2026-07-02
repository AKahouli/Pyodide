import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FlowPromptTemplate, FlowPromptTemplateDocument } from '../schemas/playbook-flow-prompt-template.schema';
import {
  FlowPromptTemplateListResponse,
  FlowPromptTemplateImportPayload,
  FlowPromptTemplateResponse,
  UpsertFlowPromptTemplateRequest,
} from '../interfaces/playbook-flow-prompt-template.interface';
import { DEFAULT_FLOW_PROMPTS } from './playbook-flow-prompt-seed';

@Injectable()
export class PlaybookFlowPromptTemplateService {
  private cachedPayload: Record<string, string> | null = null;
  private cachedItems: FlowPromptTemplateResponse[] | null = null;
  private cachedAt = 0;
  private static readonly CACHE_TTL_MS = 30_000;

  constructor(
    @InjectModel(FlowPromptTemplate.name)
    private readonly promptModel: Model<FlowPromptTemplateDocument>,
  ) {}

  private toResponse(doc: FlowPromptTemplateDocument | FlowPromptTemplate): FlowPromptTemplateResponse {
    return {
      id: (doc as any)._id.toString(), key: doc.key, title: doc.title,
      category: doc.category, description: doc.description,
      systemTemplate: doc.systemTemplate || '', userTemplate: doc.userTemplate || '',
      enabled: doc.enabled, version: doc.version, isBuiltIn: doc.isBuiltIn,
      createdAt: doc.createdAt?.toISOString?.() || new Date().toISOString(),
      updatedAt: doc.updatedAt?.toISOString?.() || new Date().toISOString(),
    };
  }

  private invalidateCache(): void {
    this.cachedPayload = null; this.cachedItems = null; this.cachedAt = 0;
  }

  private async seedDefaultsIfNeeded(): Promise<void> {
    const keys = DEFAULT_FLOW_PROMPTS.map((item) => item.key);
    const existing = await this.promptModel.find({ key: { $in: keys } }).select('key version isBuiltIn').lean().exec();
    const totalCount = await this.promptModel.estimatedDocumentCount().exec();
    const existingByKey = new Map(existing.map((item) => [item.key, item]));
    const existingKeys = new Set(existing.map((item) => item.key));
    const missing = totalCount === 0 ? DEFAULT_FLOW_PROMPTS.filter((item) => !existingKeys.has(item.key)) : [];

    if (missing.length) {
      await this.promptModel.insertMany(
        missing.map((item) => ({ ...item, createdBy: null, updatedBy: null })),
        { ordered: false },
      );
    }

    const builtInUpdates = DEFAULT_FLOW_PROMPTS.filter((item) => {
      const ex = existingByKey.get(item.key) as { version?: number; isBuiltIn?: boolean } | undefined;
      return ex?.isBuiltIn === true && (ex.version || 1) < item.version;
    });

    if (builtInUpdates.length) {
      await Promise.all(builtInUpdates.map((item) =>
        this.promptModel.updateOne(
          { key: item.key, isBuiltIn: true, version: { $lt: item.version } },
          { $set: { ...item, updatedBy: null } },
        ).exec(),
      ));
    }

    if (missing.length || builtInUpdates.length) this.invalidateCache();
  }

  async findAll(): Promise<FlowPromptTemplateListResponse> {
    await this.seedDefaultsIfNeeded();
    const now = Date.now();
    if (this.cachedItems && now - this.cachedAt < PlaybookFlowPromptTemplateService.CACHE_TTL_MS) {
      return { items: this.cachedItems };
    }
    const docs = await this.promptModel.find({}).sort({ category: 1, title: 1 }).exec();
    const items = docs.map((doc) => this.toResponse(doc));
    this.cachedItems = items; this.cachedAt = now;
    return { items };
  }

  async findByKey(key: string): Promise<FlowPromptTemplateResponse | null> {
    await this.seedDefaultsIfNeeded();
    const doc = await this.promptModel.findOne({ key }).exec();
    return doc ? this.toResponse(doc) : null;
  }

  async upsert(key: string, dto: UpsertFlowPromptTemplateRequest, userId: string): Promise<FlowPromptTemplateResponse> {
    await this.seedDefaultsIfNeeded();
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) throw new Error('Prompt key is required');

    const existing = await this.promptModel.findOne({ key: normalizedKey }).exec();
    const nextVersion = (existing?.version || 0) + 1;
    const payload = {
      key: normalizedKey, title: dto.title.trim(), category: dto.category.trim(),
      description: dto.description?.trim() || '',
      systemTemplate: dto.systemTemplate ?? existing?.systemTemplate ?? '',
      userTemplate: dto.userTemplate ?? existing?.userTemplate ?? '',
      enabled: dto.enabled ?? existing?.enabled ?? true,
      version: nextVersion, isBuiltIn: existing?.isBuiltIn ?? false,
      updatedBy: new Types.ObjectId(userId),
      createdBy: existing?.createdBy ?? new Types.ObjectId(userId),
    };

    const updated = await this.promptModel.findOneAndUpdate(
      { key: normalizedKey }, { $set: payload }, { new: true, upsert: true },
    ).exec();

    this.invalidateCache();
    return this.toResponse(updated);
  }

  async getPromptOverridesPayload(): Promise<Record<string, string>> {
    await this.seedDefaultsIfNeeded();
    const now = Date.now();
    if (this.cachedPayload && now - this.cachedAt < PlaybookFlowPromptTemplateService.CACHE_TTL_MS) {
      return this.cachedPayload;
    }
    const docs = await this.promptModel.find({ enabled: true }).exec();
    const payload = docs.reduce<Record<string, string>>((acc, doc) => {
      acc[doc.key] = JSON.stringify(this.toResponse(doc));
      return acc;
    }, {});
    this.cachedPayload = payload; this.cachedAt = now;
    return payload;
  }

  async remove(key: string): Promise<boolean> {
    const existing = await this.promptModel.findOne({ key }).exec();
    if (!existing) return false;
    if (existing.isBuiltIn) throw new Error('Cannot delete built-in prompt templates');
    await this.promptModel.deleteOne({ key }).exec();
    this.invalidateCache();
    return true;
  }

  async replaceAll(payload: FlowPromptTemplateImportPayload, userId: string): Promise<FlowPromptTemplateListResponse> {
    const keys = payload.items.map((item) => item.key.trim());
    if (keys.some((key) => !key)) throw new BadRequestException('Import contains an empty prompt key');
    if (new Set(keys).size !== keys.length) throw new BadRequestException('Import contains duplicate prompt keys');

    const userObjectId = new Types.ObjectId(userId);
    const docs = payload.items.map((item) => ({
      key: item.key.trim(),
      title: item.title.trim(),
      category: item.category.trim(),
      description: item.description?.trim() || '',
      systemTemplate: item.systemTemplate ?? '',
      userTemplate: item.userTemplate ?? '',
      enabled: item.enabled ?? true,
      version: 1,
      isBuiltIn: item.isBuiltIn ?? false,
      createdBy: userObjectId,
      updatedBy: userObjectId,
    }));

    if (docs.length) {
      await this.promptModel.bulkWrite(docs.map((doc) => ({
        updateOne: {
          filter: { key: doc.key },
          update: { $set: doc },
          upsert: true,
        },
      })), { ordered: true });
    }
    await this.promptModel.deleteMany({ key: { $nin: keys } }).exec();
    this.invalidateCache();
    const importedDocs = await this.promptModel.find({}).sort({ category: 1, title: 1 }).exec();
    return { items: importedDocs.map((doc) => this.toResponse(doc)) };
  }

  async resetCache(): Promise<void> { this.invalidateCache(); }
}

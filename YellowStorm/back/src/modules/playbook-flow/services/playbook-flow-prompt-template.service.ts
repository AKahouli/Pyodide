import { BadRequestException, Injectable } from '@nestjs/common';
import {
  FlowPromptTemplateListResponse,
  FlowPromptTemplateImportPayload,
  FlowPromptTemplateResponse,
  UpsertFlowPromptTemplateRequest,
} from '../interfaces/playbook-flow-prompt-template.interface';
import { PromptTemplateRepository, type PromptTemplateRecord } from '../persistence/prompt-template.repository';
import { TEMPLATE_MAX_LENGTHS } from '../persistence/template-cast';
import { DEFAULT_FLOW_PROMPTS } from './playbook-flow-prompt-seed';

/**
 * The varchar columns refuse what Mongoose's `maxlength` only checked on insert (edits and imports
 * stored any length): an over-long value is a 400 instead of a database error.
 */
function assertLengths(fields: { key?: string; title?: string; category?: string; description?: string }): void {
  for (const field of ['key', 'title', 'category', 'description'] as const) {
    const value = fields[field];
    const max = TEMPLATE_MAX_LENGTHS[field];
    if (typeof value === 'string' && value.trim().length > max) {
      throw new BadRequestException(`${field} must be at most ${max} characters`);
    }
  }
}

@Injectable()
export class PlaybookFlowPromptTemplateService {
  private cachedPayload: Record<string, string> | null = null;
  private cachedItems: FlowPromptTemplateResponse[] | null = null;
  private cachedAt = 0;
  private static readonly CACHE_TTL_MS = 30_000;

  constructor(private readonly prompts: PromptTemplateRepository) {}

  private toResponse(record: PromptTemplateRecord): FlowPromptTemplateResponse {
    return {
      id: record.id, key: record.key, title: record.title,
      category: record.category, description: record.description ?? undefined,
      systemTemplate: record.systemTemplate || '', userTemplate: record.userTemplate || '',
      enabled: record.enabled, version: record.version, isBuiltIn: record.isBuiltIn,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private invalidateCache(): void {
    this.cachedPayload = null; this.cachedItems = null; this.cachedAt = 0;
  }

  /**
   * Seeds the built-in prompts into an empty catalogue, and moves a built-in prompt to a newer seed
   * version. A prompt that is no longer built in, or already at the seed's version, is never touched.
   */
  private async seedDefaultsIfNeeded(): Promise<void> {
    const keys = DEFAULT_FLOW_PROMPTS.map((item) => item.key);
    const existing = await this.prompts.findVersions(keys);
    const empty = await this.prompts.isEmpty();
    const existingByKey = new Map(existing.map((item) => [item.key, item]));
    const missing = empty ? DEFAULT_FLOW_PROMPTS.filter((item) => !existingByKey.has(item.key)) : [];

    if (missing.length) {
      await this.prompts.insertMissing(missing.map((item) => ({ ...item, createdBy: null, updatedBy: null })));
    }

    const builtInUpdates = DEFAULT_FLOW_PROMPTS.filter((item) => {
      const ex = existingByKey.get(item.key);
      return ex?.isBuiltIn === true && (ex.version || 1) < item.version;
    });

    if (builtInUpdates.length) {
      await Promise.all(builtInUpdates.map((item) => this.prompts.upgradeBuiltIn(item)));
    }

    if (missing.length || builtInUpdates.length) this.invalidateCache();
  }

  async findAll(): Promise<FlowPromptTemplateListResponse> {
    await this.seedDefaultsIfNeeded();
    const now = Date.now();
    if (this.cachedItems && now - this.cachedAt < PlaybookFlowPromptTemplateService.CACHE_TTL_MS) {
      return { items: this.cachedItems };
    }
    const records = await this.prompts.list();
    const items = records.map((record) => this.toResponse(record));
    this.cachedItems = items; this.cachedAt = now;
    return { items };
  }

  async findByKey(key: string): Promise<FlowPromptTemplateResponse | null> {
    await this.seedDefaultsIfNeeded();
    const record = await this.prompts.findByKey(key);
    return record ? this.toResponse(record) : null;
  }

  async upsert(key: string, dto: UpsertFlowPromptTemplateRequest, userId: string): Promise<FlowPromptTemplateResponse> {
    await this.seedDefaultsIfNeeded();
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) throw new Error('Prompt key is required');

    const edit = {
      title: dto.title.trim(), category: dto.category.trim(),
      description: dto.description?.trim() || '',
      systemTemplate: dto.systemTemplate, userTemplate: dto.userTemplate, enabled: dto.enabled,
    };
    assertLengths({ key: normalizedKey, ...edit });
    const updated = await this.prompts.upsertByKey(normalizedKey, edit, userId);

    this.invalidateCache();
    return this.toResponse(updated);
  }

  async getPromptOverridesPayload(): Promise<Record<string, string>> {
    await this.seedDefaultsIfNeeded();
    const now = Date.now();
    if (this.cachedPayload && now - this.cachedAt < PlaybookFlowPromptTemplateService.CACHE_TTL_MS) {
      return this.cachedPayload;
    }
    const records = await this.prompts.list({ enabledOnly: true });
    const payload = records.reduce<Record<string, string>>((acc, record) => {
      acc[record.key] = JSON.stringify(this.toResponse(record));
      return acc;
    }, {});
    this.cachedPayload = payload; this.cachedAt = now;
    return payload;
  }

  async remove(key: string): Promise<boolean> {
    const existing = await this.prompts.findByKey(key);
    if (!existing) return false;
    if (existing.isBuiltIn) throw new Error('Cannot delete built-in prompt templates');
    await this.prompts.deleteByKey(key);
    this.invalidateCache();
    return true;
  }

  async replaceAll(payload: FlowPromptTemplateImportPayload, userId: string): Promise<FlowPromptTemplateListResponse> {
    const keys = payload.items.map((item) => item.key.trim());
    if (keys.some((key) => !key)) throw new BadRequestException('Import contains an empty prompt key');
    if (new Set(keys).size !== keys.length) throw new BadRequestException('Import contains duplicate prompt keys');

    const items = payload.items.map((item) => ({
      key: item.key.trim(),
      title: item.title.trim(),
      category: item.category.trim(),
      description: item.description?.trim() || '',
      systemTemplate: item.systemTemplate ?? '',
      userTemplate: item.userTemplate ?? '',
      enabled: item.enabled ?? true,
      version: 1,
      isBuiltIn: item.isBuiltIn ?? false,
      createdBy: userId,
      updatedBy: userId,
    }));
    items.forEach(assertLengths);

    await this.prompts.replaceAll(items);
    this.invalidateCache();
    const imported = await this.prompts.list();
    return { items: imported.map((record) => this.toResponse(record)) };
  }

  async resetCache(): Promise<void> { this.invalidateCache(); }
}

import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '../logger';
import { LiteLLMClient } from './litellm.client';
import { AiModel, AiModelDocument } from './schemas/model.schema';
import {
  LiteLLMModelInfoEntry,
  LiteLLMHealthStatus,
  ModelInputModality,
  ModelResponse,
  ModelsListResponse,
  ReasoningEffortOption,
} from './interfaces/model.interface';
import { BadRequestException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';

// Provider display name mappings
const CHEF_DISPLAY_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  azure: 'Azure',
  cohere: 'Cohere',
  mistral: 'Mistral AI',
  meta: 'Meta',
  'meta-llama': 'Meta',
  deepseek: 'DeepSeek',
  groq: 'Groq',
  perplexity: 'Perplexity',
  together: 'Together AI',
  anyscale: 'Anyscale',
  replicate: 'Replicate',
  huggingface: 'Hugging Face',
  bedrock: 'AWS Bedrock',
  vertex_ai: 'Google Vertex AI',
  sagemaker: 'AWS SageMaker',
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
  custom: 'Custom',
};

@Injectable()
export class ModelsService implements OnApplicationBootstrap {
  constructor(
    @InjectModel(AiModel.name)
    private readonly aiModelModel: Model<AiModelDocument>,
    private readonly litellmClient: LiteLLMClient,
    private readonly logger: LoggerService,
  ) { }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.litellmClient.isConfigured()) {
      this.logger.warn('LiteLLM not configured, skipping model sync on startup', {
        context: 'ModelsService',
      });
      return;
    }

    // Sync models on app startup (non-blocking)
    this.syncModels().catch((error) => {
      this.logger.warn('Failed to sync models on startup', {
        context: 'ModelsService',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });
  }

  async syncModels(): Promise<{ added: number; updated: number; reactivated: number; deactivated: number; total: number }> {
    this.logger.log('Starting model sync from LiteLLM', {
      context: 'ModelsService',
    });

    const litellmEntries = await this.litellmClient.fetchModels();

    if (litellmEntries.length === 0) {
      this.logger.warn('No models returned from LiteLLM', {
        context: 'ModelsService',
      });
      return { added: 0, updated: 0, reactivated: 0, deactivated: 0, total: 0 };
    }

    // Ingest ALL model types (chat, embedding, image_generation, etc.).
    // Classification is no longer filtered here — the `types` field is set from
    // LiteLLM's mode for new models and managed by the admin afterwards.
    this.logger.log('Fetched models from LiteLLM response', {
      context: 'ModelsService',
      totalEntries: litellmEntries.length,
    });

    let addedCount = 0;
    let updatedCount = 0;
    let reactivatedCount = 0;

    // Collect all model IDs from LiteLLM
    const litellmModelIds = new Set(litellmEntries.map((m) => m.model_name));

    // Process each model from LiteLLM
    for (const entry of litellmEntries) {
      try {
        const existingModel = await this.aiModelModel.findOne({ modelId: entry.model_name });

        if (!existingModel) {
          // New model - insert with all fields
          const transformedData = this.transformModel(entry);
          await this.aiModelModel.create({
            ...transformedData,
            isActive: true,
          });
          addedCount++;
        } else {
          // Model exists — always update chefSlug, litellmModel, providers (these come from the source of truth)
          const chefSlug = (entry.model_info?.litellm_provider || '').toLowerCase();
          const litellmModel = String(entry.litellm_params?.model || '').trim();
          const updateFields: Record<string, unknown> = {
            chefSlug,
            litellmModel,
            providers: [chefSlug],
            chef: this.getChefDisplayName(chefSlug),
            maxInputTokens: this.nullableNumber(entry.model_info?.max_input_tokens),
            maxOutputTokens: this.nullableNumber(entry.model_info?.max_output_tokens),
            supportsReasoning: typeof entry.model_info?.supports_reasoning === 'boolean' ? entry.model_info.supports_reasoning : null,
          };
          const publishedEfforts = this.extractReasoningEfforts(entry);
          if (publishedEfforts.length > 0) updateFields.reasoningEfforts = publishedEfforts;

          if (!existingModel.isActive) {
            // Reactivate
            updateFields.isActive = true;
            reactivatedCount++;
          }

          const hasChanges =
            existingModel.chefSlug !== chefSlug ||
            existingModel.litellmModel !== litellmModel ||
            existingModel.maxInputTokens !== updateFields.maxInputTokens ||
            existingModel.maxOutputTokens !== updateFields.maxOutputTokens ||
            existingModel.supportsReasoning !== updateFields.supportsReasoning ||
            (publishedEfforts.length > 0 && JSON.stringify(existingModel.reasoningEfforts ?? []) !== JSON.stringify(publishedEfforts)) ||
            !existingModel.isActive;

          if (hasChanges) {
            await this.aiModelModel.updateOne(
              { modelId: entry.model_name },
              { $set: updateFields },
            );
            if (existingModel.isActive) updatedCount++;
          }
        }
      } catch (error) {
        this.logger.error('Failed to sync model', {
          context: 'ModelsService',
          modelId: entry.model_name,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Mark models not in LiteLLM as inactive
    let deactivatedCount = 0;
    try {
      const result = await this.aiModelModel.updateMany(
        {
          modelId: { $nin: Array.from(litellmModelIds) },
          isActive: true,
        },
        { $set: { isActive: false } },
      );
      deactivatedCount = result.modifiedCount;

      if (deactivatedCount > 0) {
        this.logger.log('Deactivated models not found in LiteLLM', {
          context: 'ModelsService',
          count: deactivatedCount,
        });
      }
    } catch (error) {
      this.logger.error('Failed to deactivate removed models', {
        context: 'ModelsService',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    this.logger.log('Model sync completed', {
      context: 'ModelsService',
      added: addedCount,
      updated: updatedCount,
      reactivated: reactivatedCount,
      deactivated: deactivatedCount,
      total: litellmEntries.length,
    });

    return {
      added: addedCount,
      updated: updatedCount,
      reactivated: reactivatedCount,
      deactivated: deactivatedCount,
      total: litellmEntries.length,
    };
  }

  /**
   * @param activeOnly restrict to active models (default true — public usage).
   * @param chatOnly   restrict to chat models only (default true). The public
   *   model selector must keep showing chat models exclusively even though the
   *   DB now also holds embeddings, image generation, etc. The admin passes
   *   false to see every type.
   */
  async findAll(activeOnly: boolean = true, chatOnly: boolean = true): Promise<ModelsListResponse> {
    const query: Record<string, unknown> = {};
    if (activeOnly) query.isActive = true;
    if (chatOnly) query.$or = [{ types: 'chat' }, { type: 'chat' }];

    const models = await this.aiModelModel
      .find(query)
      .sort({ chef: 1, name: 1 })
      .lean()
      .exec();

    return {
      models: models.map((model) => this.toModelResponse(model)),
      total: models.length,
    };
  }

  async findById(id: string): Promise<ModelResponse | null> {
    const model = await this.aiModelModel.findOne({ modelId: id }).lean().exec();

    if (!model) {
      return null;
    }

    return this.toModelResponse(model);
  }

  /**
   * Check if a model exists and is active.
   * Returns the model if valid, null if not found, throws if inactive.
   */
  async validateModelActive(
    id: string,
    requiredType?: string,
  ): Promise<{ valid: boolean; model: ModelResponse | null; inactive: boolean; unsupported: boolean }> {
    const model = await this.aiModelModel.findOne({ modelId: id }).lean().exec();

    if (!model) {
      return { valid: false, model: null, inactive: false, unsupported: false };
    }

    if (!model.isActive) {
      return { valid: false, model: this.toModelResponse(model), inactive: true, unsupported: false };
    }

    const response = this.toModelResponse(model);
    if (requiredType && !response.types.includes(requiredType)) {
      return { valid: false, model: response, inactive: false, unsupported: true };
    }

    return { valid: true, model: response, inactive: false, unsupported: false };
  }

  async findByChef(chefSlug: string): Promise<ModelsListResponse> {
    const models = await this.aiModelModel
      .find({
        chefSlug: chefSlug.toLowerCase(),
        isActive: true,
        $or: [{ types: 'chat' }, { type: 'chat' }],
      })
      .sort({ name: 1 })
      .lean()
      .exec();

    return {
      models: models.map((model) => this.toModelResponse(model)),
      total: models.length,
    };
  }

  getHealthStatus(): LiteLLMHealthStatus {
    return this.litellmClient.getHealthStatus();
  }

  private transformModel(
    entry: LiteLLMModelInfoEntry,
  ): Partial<AiModel> {
    const chefSlug = (entry.model_info?.litellm_provider || '').toLowerCase();
    const litellmModel = String(entry.litellm_params?.model || '').trim();

    return {
      modelId: entry.model_name,
      name: this.generateDisplayName(entry.model_name),
      chef: this.getChefDisplayName(chefSlug),
      chefSlug,
      litellmModel,
      providers: [chefSlug],
      // Initialise classification from LiteLLM's mode when available; otherwise
      // leave empty so the admin can set it. Only applied to NEW models — a
      // re-sync never overwrites an existing model's type (admin choice wins).
      type: entry.model_info?.mode || '',
      types: entry.model_info?.mode ? [entry.model_info.mode] : [],
      inputModalities: ['text'],
      maxInputTokens: this.nullableNumber(entry.model_info?.max_input_tokens),
      maxOutputTokens: this.nullableNumber(entry.model_info?.max_output_tokens),
      supportsReasoning: typeof entry.model_info?.supports_reasoning === 'boolean' ? entry.model_info.supports_reasoning : null,
      reasoningEfforts: this.extractReasoningEfforts(entry),
    };
  }

  private nullableNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  }

  private extractReasoningEfforts(entry: LiteLLMModelInfoEntry): ReasoningEffortOption[] {
    const source = entry.model_info.reasoning_efforts ?? entry.model_info.supported_reasoning_efforts;
    if (!Array.isArray(source)) return [];
    return source.flatMap((item): ReasoningEffortOption[] => {
      if (typeof item === 'string' && item.trim()) return [{ id: item.trim(), name: this.generateDisplayName(item.trim()) }];
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      if (typeof record.id !== 'string' || !record.id.trim()) return [];
      return [{
        id: record.id.trim(),
        name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : this.generateDisplayName(record.id.trim()),
        ...(typeof record.description === 'string' && record.description.trim() ? { description: record.description.trim() } : {}),
      }];
    });
  }

  private generateDisplayName(id: string): string {
    // Handle common model naming patterns
    // "gpt-4o" -> "GPT-4o"
    // "claude-3-opus-20240229" -> "Claude 3 Opus"
    // "gemini-1.5-pro" -> "Gemini 1.5 Pro"

    // Remove date suffixes (e.g., "-20240229")
    let name = id.replace(/-\d{8}$/, '');

    // Split by hyphens and underscores
    const parts = name.split(/[-_]/);

    // Process each part
    const processedParts = parts.map((part) => {
      // Keep version numbers as-is (e.g., "1.5", "4o", "3.5")
      if (/^\d/.test(part) || /^[a-z]?\d/.test(part)) {
        return part;
      }

      // Known acronyms to keep uppercase
      const uppercaseAcronyms = ['gpt', 'llm', 'ai', 'api'];
      if (uppercaseAcronyms.includes(part.toLowerCase())) {
        return part.toUpperCase();
      }

      // Capitalize first letter
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    });

    return processedParts.join(' ').trim();
  }

  private getChefDisplayName(chefSlug: string): string {
    const key = chefSlug.toLowerCase();
    return CHEF_DISPLAY_NAMES[key] || this.capitalizeFirst(chefSlug);
  }

  private capitalizeFirst(str: string): string {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  async updateModel(
    id: string,
    data: Partial<{ name: string; chef: string; chefSlug: string; providers: string[]; type: string; types: string[]; isActive: boolean; omitTemperature: boolean; inputModalities: ModelInputModality[]; reasoningEfforts: ReasoningEffortOption[]; defaultReasoningEffort: string | null }>,
  ): Promise<ModelResponse | null> {
    const update = { ...data };
    if (update.types) {
      update.type = update.types[0] || '';
    } else if (update.type !== undefined) {
      update.types = update.type ? [update.type] : [];
    }
    if (update.defaultReasoningEffort && update.reasoningEfforts && !update.reasoningEfforts.some((effort) => effort.id === update.defaultReasoningEffort)) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Default reasoning effort must be included in the supported efforts.');
    }
    const clearDefaultReasoningEffort = update.defaultReasoningEffort === null;
    if (clearDefaultReasoningEffort) delete update.defaultReasoningEffort;

    const model = await this.aiModelModel
      .findOneAndUpdate(
        { modelId: id },
        {
          $set: update,
          ...(clearDefaultReasoningEffort ? { $unset: { defaultReasoningEffort: 1 } } : {}),
        },
        { new: true },
      )
      .lean()
      .exec();

    if (!model) {
      return null;
    }

    const assignedTypes = Array.isArray(model.types) ? model.types : [];
    if (model.isActive && (assignedTypes.includes('guardrails_classifier') || model.type === 'guardrails_classifier')) {
      await this.aiModelModel.updateMany(
        { modelId: { $ne: id }, isActive: true },
        { $pull: { types: 'guardrails_classifier' } },
      );
      await this.aiModelModel.updateMany(
        { modelId: { $ne: id }, isActive: true, type: 'guardrails_classifier' },
        { $set: { type: '' } },
      );
    }

    this.logger.log('Model updated', {
      context: 'ModelsService',
      modelId: id,
      changes: Object.keys(update),
    });

    return this.toModelResponse(model);
  }

  async setDefaultModel(id: string): Promise<ModelResponse | null> {
    // First, verify the model exists
    const model = await this.aiModelModel.findOne({
      modelId: id,
      isActive: true,
      $or: [{ types: 'chat' }, { type: 'chat' }],
    }).lean().exec();
    if (!model) {
      return null;
    }

    // Clear any existing default
    await this.aiModelModel.updateMany(
      { isDefault: true },
      { $set: { isDefault: false } },
    );

    // Set the new default
    const updatedModel = await this.aiModelModel
      .findOneAndUpdate(
        { modelId: id },
        { $set: { isDefault: true } },
        { new: true },
      )
      .lean()
      .exec();

    this.logger.log('Default model set', {
      context: 'ModelsService',
      modelId: id,
    });

    return updatedModel ? this.toModelResponse(updatedModel) : null;
  }

  async clearDefaultModel(id: string): Promise<ModelResponse | null> {
    const model = await this.aiModelModel
      .findOneAndUpdate(
        { modelId: id },
        { $set: { isDefault: false } },
        { new: true },
      )
      .lean()
      .exec();

    if (!model) {
      return null;
    }

    this.logger.log('Default model cleared', {
      context: 'ModelsService',
      modelId: id,
    });

    return this.toModelResponse(model);
  }

  async getDefaultModel(): Promise<ModelResponse | null> {
    const model = await this.aiModelModel
      .findOne({
        isDefault: true,
        isActive: true,
        $or: [{ types: 'chat' }, { type: 'chat' }],
      })
      .lean()
      .exec();

    return model ? this.toModelResponse(model) : null;
  }

  /**
   * Conversation-v2 default (reused by the conversation-v2 flow only). Set by
   * an admin on an existing model (e.g. the OpenCode-provider DeepSeek V4
   * Flash) via `setConversationV2DefaultModel` — no new model config is
   * created. Falls back to the global default when no model is flagged.
   */
  async getConversationV2DefaultModel(): Promise<ModelResponse | null> {
    const model = await this.aiModelModel
      .findOne({
        isConversationV2Default: true,
        isActive: true,
        $or: [{ types: 'chat' }, { type: 'chat' }],
      })
      .lean()
      .exec();

    return model ? this.toModelResponse(model) : null;
  }

  async setConversationV2DefaultModel(id: string): Promise<ModelResponse | null> {
    // First, verify the model exists (active chat model)
    const model = await this.aiModelModel.findOne({
      modelId: id,
      isActive: true,
      $or: [{ types: 'chat' }, { type: 'chat' }],
    }).lean().exec();
    if (!model) {
      return null;
    }

    // Clear any existing conversation-v2 default
    await this.aiModelModel.updateMany(
      { isConversationV2Default: true },
      { $set: { isConversationV2Default: false } },
    );

    // Set the new conversation-v2 default
    const updatedModel = await this.aiModelModel
      .findOneAndUpdate(
        { modelId: id },
        { $set: { isConversationV2Default: true } },
        { new: true },
      )
      .lean()
      .exec();

    this.logger.log('Conversation-v2 default model set', {
      context: 'ModelsService',
      modelId: id,
    });

    return updatedModel ? this.toModelResponse(updatedModel) : null;
  }

  async clearConversationV2DefaultModel(id: string): Promise<ModelResponse | null> {
    const model = await this.aiModelModel
      .findOneAndUpdate(
        { modelId: id },
        { $set: { isConversationV2Default: false } },
        { new: true },
      )
      .lean()
      .exec();

    if (!model) {
      return null;
    }

    this.logger.log('Conversation-v2 default model cleared', {
      context: 'ModelsService',
      modelId: id,
    });

    return this.toModelResponse(model);
  }

  async getGuardrailsClassifierModel(): Promise<ModelResponse | null> {
    const model = await this.aiModelModel
      .findOne({
        isActive: true,
        $or: [{ types: 'guardrails_classifier' }, { type: 'guardrails_classifier' }],
      })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();

    return model ? this.toModelResponse(model) : null;
  }

  getModelIdentifier(model: Pick<ModelResponse, 'id' | 'litellmModel'> | null | undefined): string {
    return model?.litellmModel || model?.id || '';
  }

  private toModelResponse(model: AiModelDocument | Record<string, unknown>): ModelResponse {
    // Handle both Mongoose document and lean object
    const doc = model as Record<string, unknown>;

    const legacyType = (doc.type as string) || '';
    const types = Array.isArray(doc.types)
      ? doc.types.filter((type): type is string => typeof type === 'string' && type.length > 0)
      : legacyType ? [legacyType] : [];
    const storedInputModalities = Array.isArray(doc.inputModalities)
      ? doc.inputModalities.filter((modality): modality is ModelInputModality => modality === 'text' || modality === 'image')
      : [];
    const inputModalities: ModelInputModality[] = storedInputModalities.includes('text')
      ? [...new Set(storedInputModalities)]
      : ['text'];

    return {
      id: doc.modelId as string,
      name: doc.name as string,
      chef: doc.chef as string,
      chefSlug: doc.chefSlug as string,
      litellmModel: (doc.litellmModel as string) || '',
      providers: doc.providers as string[],
      type: types[0] || legacyType,
      types,
      isActive: doc.isActive as boolean,
      isDefault: (doc.isDefault as boolean) || false,
      isConversationV2Default: (doc.isConversationV2Default as boolean) || false,
      omitTemperature: (doc.omitTemperature as boolean) || false,
      inputModalities,
      maxInputTokens: typeof doc.maxInputTokens === 'number' ? doc.maxInputTokens : null,
      maxOutputTokens: typeof doc.maxOutputTokens === 'number' ? doc.maxOutputTokens : null,
      supportsReasoning: typeof doc.supportsReasoning === 'boolean' ? doc.supportsReasoning : null,
      reasoning: {
        efforts: Array.isArray(doc.reasoningEfforts)
          ? doc.reasoningEfforts.flatMap((effort): ReasoningEffortOption[] => {
              if (!effort || typeof effort !== 'object') return [];
              const value = effort as Record<string, unknown>;
              return typeof value.id === 'string' && typeof value.name === 'string'
                ? [{ id: value.id, name: value.name, ...(typeof value.description === 'string' ? { description: value.description } : {}) }]
                : [];
            })
          : [],
        ...(typeof doc.defaultReasoningEffort === 'string' ? { defaultEffort: doc.defaultReasoningEffort } : {}),
      },
    };
  }
}

import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '../logger';
import { LiteLLMClient } from './litellm.client';
import { AiModel, AiModelDocument } from './schemas/model.schema';
import {
  LiteLLMModelInfoEntry,
  LiteLLMHealthStatus,
  ModelResponse,
  ModelsListResponse,
} from './interfaces/model.interface';

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
  ) {}

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

    // Filter to chat models only (exclude embeddings etc.)
    const chatModels = litellmEntries.filter(
      (entry) => entry.model_info?.mode === 'chat',
    );

    this.logger.log('Filtered chat models from LiteLLM response', {
      context: 'ModelsService',
      totalEntries: litellmEntries.length,
      chatModels: chatModels.length,
    });

    let addedCount = 0;
    let updatedCount = 0;
    let reactivatedCount = 0;

    // Collect all model IDs from LiteLLM
    const litellmModelIds = new Set(chatModels.map((m) => m.model_name));

    // Process each model from LiteLLM
    for (const entry of chatModels) {
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
          const litellmModel =
            (entry.model_info?.litellm_provider && entry.model_name)
              ? `${entry.model_info.litellm_provider}/${entry.model_name}`
              : entry.litellm_params?.model || '';
          const updateFields: Record<string, unknown> = {
            chefSlug,
            litellmModel,
            providers: [chefSlug],
            chef: this.getChefDisplayName(chefSlug),
          };

          if (!existingModel.isActive) {
            // Reactivate
            updateFields.isActive = true;
            reactivatedCount++;
          }

          const hasChanges =
            existingModel.chefSlug !== chefSlug ||
            existingModel.litellmModel !== litellmModel ||
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
      total: chatModels.length,
    });

    return {
      added: addedCount,
      updated: updatedCount,
      reactivated: reactivatedCount,
      deactivated: deactivatedCount,
      total: chatModels.length,
    };
  }

  async findAll(activeOnly: boolean = true): Promise<ModelsListResponse> {
    const query = activeOnly ? { isActive: true } : {};

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
  async validateModelActive(id: string): Promise<{ valid: boolean; model: ModelResponse | null; inactive: boolean }> {
    const model = await this.aiModelModel.findOne({ modelId: id }).lean().exec();

    if (!model) {
      return { valid: false, model: null, inactive: false };
    }

    if (!model.isActive) {
      return { valid: false, model: this.toModelResponse(model), inactive: true };
    }

    return { valid: true, model: this.toModelResponse(model), inactive: false };
  }

  async findByChef(chefSlug: string): Promise<ModelsListResponse> {
    const models = await this.aiModelModel
      .find({ chefSlug: chefSlug.toLowerCase(), isActive: true })
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
    const litellmModel =
      (entry.model_info?.litellm_provider && entry.model_name)
        ? `${entry.model_info.litellm_provider}/${entry.model_name}`
        : entry.litellm_params?.model || '';

    return {
      modelId: entry.model_name,
      name: this.generateDisplayName(entry.model_name),
      chef: this.getChefDisplayName(chefSlug),
      chefSlug,
      litellmModel,
      providers: [chefSlug],
    };
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
    data: Partial<{ name: string; chef: string; chefSlug: string; providers: string[]; isActive: boolean }>,
  ): Promise<ModelResponse | null> {
    const model = await this.aiModelModel
      .findOneAndUpdate(
        { modelId: id },
        { $set: data },
        { new: true },
      )
      .lean()
      .exec();

    if (!model) {
      return null;
    }

    this.logger.log('Model updated', {
      context: 'ModelsService',
      modelId: id,
      changes: Object.keys(data),
    });

    return this.toModelResponse(model);
  }

  async setDefaultModel(id: string): Promise<ModelResponse | null> {
    // First, verify the model exists
    const model = await this.aiModelModel.findOne({ modelId: id }).lean().exec();
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
      .findOne({ isDefault: true })
      .lean()
      .exec();

    return model ? this.toModelResponse(model) : null;
  }

  private toModelResponse(model: AiModelDocument | Record<string, unknown>): ModelResponse {
    // Handle both Mongoose document and lean object
    const doc = model as Record<string, unknown>;

    return {
      id: doc.modelId as string,
      name: doc.name as string,
      chef: doc.chef as string,
      chefSlug: doc.chefSlug as string,
      litellmModel: (doc.litellmModel as string) || '',
      providers: doc.providers as string[],
      isActive: doc.isActive as boolean,
      isDefault: (doc.isDefault as boolean) || false,
    };
  }
}

import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { ModelsService } from '@modules/models/models.service';
import { SystemService } from '@modules/system/system.service';
import type { AdminPlaybookSettings } from '@modules/system/interfaces/playbook-settings.interface';
import {
  FlowDesignSettings,
  EffectiveFlowDesignSettings,
  UpdateFlowDesignSettingsDto,
  DEFAULT_FLOW_DESIGN_SETTINGS,
} from '../interfaces/playbook-flow-settings.interface';

@Injectable()
export class PlaybookFlowSettingsService {
  constructor(
    private readonly systemService: SystemService,
    private readonly modelsService: ModelsService,
  ) {}

  async getAdminSettings(): Promise<AdminPlaybookSettings> {
    return this.systemService.getPlaybookSettings();
  }

  async resolveAdvisorEvaluationModelId(): Promise<string> {
    const adminSettings = await this.getAdminSettings();
    const configuredModelId = adminSettings.advisorEvaluationModelId?.trim() || null;

    if (configuredModelId) {
      const validation = await this.modelsService.validateModelActive(configuredModelId);
      if (validation.valid && validation.model) {
        const identifier = this.modelsService.getModelIdentifier(validation.model);
        if (identifier) {
          return identifier;
        }
      }

      throw new BadRequestException(ErrorCode.MODEL_INACTIVE, 'Advisor evaluation model is unavailable.');
    }

    const defaultModel = await this.modelsService.getDefaultModel();
    const fallbackIdentifier = this.modelsService.getModelIdentifier(defaultModel);
    if (!fallbackIdentifier) {
      throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR);
    }

    return fallbackIdentifier;
  }

  getDefaultPlaybookSettings(): FlowDesignSettings {
    return { ...DEFAULT_FLOW_DESIGN_SETTINGS };
  }

  normalizePlaybookSettings(
    input: Partial<FlowDesignSettings> | Record<string, unknown> | null | undefined,
  ): FlowDesignSettings {
    return {
      inferenceModelId: typeof input?.inferenceModelId === 'string' ? input.inferenceModelId.trim() || null : null,
      nodeSuggestionsMode: input?.nodeSuggestionsMode === 'auto' || input?.nodeSuggestionsMode === 'manual'
        ? input.nodeSuggestionsMode as FlowDesignSettings['nodeSuggestionsMode'] : 'inherit',
      approvalSuggestionMode: input?.approvalSuggestionMode === 'auto' || input?.approvalSuggestionMode === 'manual'
        ? input.approvalSuggestionMode as FlowDesignSettings['approvalSuggestionMode'] : 'inherit',
      recursionLimit: typeof input?.recursionLimit === 'number' && input.recursionLimit > 0
        ? Math.min(Math.round(input.recursionLimit), 50) : 25,
      maxParallelism: typeof input?.maxParallelism === 'number' && input.maxParallelism > 0
        ? Math.min(Math.round(input.maxParallelism), 10) : 5,
    };
  }

  mergePlaybookSettingsPatch(
    current: Partial<FlowDesignSettings> | Record<string, unknown> | null | undefined,
    patch: UpdateFlowDesignSettingsDto | undefined,
  ): FlowDesignSettings {
    const normalizedCurrent = this.normalizePlaybookSettings(current);
    if (!patch) return normalizedCurrent;

    return {
      inferenceModelId: patch.inferenceModelId === undefined
        ? normalizedCurrent.inferenceModelId : (patch.inferenceModelId?.trim() || null),
      nodeSuggestionsMode: patch.nodeSuggestionsMode ?? normalizedCurrent.nodeSuggestionsMode,
      approvalSuggestionMode: patch.approvalSuggestionMode ?? normalizedCurrent.approvalSuggestionMode,
      recursionLimit: patch.recursionLimit ?? normalizedCurrent.recursionLimit,
      maxParallelism: patch.maxParallelism ?? normalizedCurrent.maxParallelism,
    };
  }

  async validatePlaybookSettingsPatch(patch: UpdateFlowDesignSettingsDto | undefined): Promise<void> {
    const inferenceModelId = patch?.inferenceModelId?.trim();
    if (!inferenceModelId) return;
    const validation = await this.modelsService.validateModelActive(inferenceModelId);
    if (!validation.valid) throw new BadRequestException(ErrorCode.BAD_REQUEST);
  }

  async resolveEffectiveSettings(
    playbookSettings?: Partial<FlowDesignSettings> | Record<string, unknown> | null,
  ): Promise<EffectiveFlowDesignSettings> {
    const adminSettings = await this.getAdminSettings();
    const normalized = this.normalizePlaybookSettings(playbookSettings);
    const resolvedInferenceModelId = normalized.inferenceModelId || adminSettings.inferenceModelId || null;

    return {
      inferenceModelId: resolvedInferenceModelId,
      advisorEvaluationModelId: adminSettings.advisorEvaluationModelId,
      nodeSuggestionsMode: normalized.nodeSuggestionsMode === 'inherit'
        ? adminSettings.nodeSuggestionsMode : normalized.nodeSuggestionsMode,
      approvalSuggestionMode: normalized.approvalSuggestionMode === 'inherit'
        ? adminSettings.approvalSuggestionMode : normalized.approvalSuggestionMode,
      resolvedInferenceModelId,
      recursionLimit: normalized.recursionLimit,
      maxParallelism: normalized.maxParallelism,
    };
  }

  async resolveInferenceModel(
    playbookSettings?: Partial<FlowDesignSettings> | Record<string, unknown> | null,
  ): Promise<string> {
    const effectiveSettings = await this.resolveEffectiveSettings(playbookSettings);

    if (effectiveSettings.resolvedInferenceModelId) {
      const validation = await this.modelsService.validateModelActive(effectiveSettings.resolvedInferenceModelId);
      if (validation.valid && validation.model) {
        const identifier = this.modelsService.getModelIdentifier(validation.model);
        if (identifier) return identifier;
      }
    }

    const defaultModel = await this.modelsService.getDefaultModel();
    const fallbackIdentifier = this.modelsService.getModelIdentifier(defaultModel);
    if (!fallbackIdentifier) throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR);
    return fallbackIdentifier;
  }
}

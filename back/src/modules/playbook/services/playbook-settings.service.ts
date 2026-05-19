import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { ModelsService } from '../../models/models.service';
import { SystemService } from '../../system/system.service';
import { DEFAULT_ADMIN_PLAYBOOK_SETTINGS, type AdminPlaybookSettings } from '../../system/interfaces/playbook-settings.interface';
import type { UpdateAdminPlaybookSettingsDto, UpdatePlaybookDesignSettingsDto } from '../dto/playbook-settings.dto';
import { DEFAULT_PLAYBOOK_DESIGN_SETTINGS, type EffectivePlaybookDesignSettings, type PlaybookDesignSettings } from '../interfaces/playbook-settings.interface';

@Injectable()
export class PlaybookSettingsService {
  constructor(
    private readonly systemService: SystemService,
    private readonly modelsService: ModelsService,
  ) {}

  async getAdminSettings(): Promise<AdminPlaybookSettings> {
    return this.systemService.getPlaybookSettings();
  }

  async updateAdminSettings(dto: UpdateAdminPlaybookSettingsDto): Promise<AdminPlaybookSettings> {
    const inferenceModelId = dto.inferenceModelId?.trim() || null;
    const advisorEvaluationModelId = dto.advisorEvaluationModelId?.trim() || null;
    if (inferenceModelId) {
      const validation = await this.modelsService.validateModelActive(inferenceModelId);
      if (!validation.valid) {
        throw new BadRequestException(ErrorCode.BAD_REQUEST);
      }
    }
    if (advisorEvaluationModelId) {
      const validation = await this.modelsService.validateModelActive(advisorEvaluationModelId);
      if (!validation.valid) {
        throw new BadRequestException(validation.inactive ? ErrorCode.MODEL_INACTIVE : ErrorCode.MODEL_NOT_FOUND);
      }
    }

    return this.systemService.setPlaybookSettings({
      inferenceModelId,
      advisorEvaluationModelId,
      nodeSuggestionsMode: dto.nodeSuggestionsMode,
      approvalSuggestionMode: dto.approvalSuggestionMode,
    });
  }

  getDefaultPlaybookSettings(): PlaybookDesignSettings {
    return { ...DEFAULT_PLAYBOOK_DESIGN_SETTINGS };
  }

  normalizePlaybookSettings(input: Partial<PlaybookDesignSettings> | Record<string, unknown> | null | undefined): PlaybookDesignSettings {
    return {
      inferenceModelId: typeof input?.inferenceModelId === 'string' ? input.inferenceModelId.trim() || null : null,
      nodeSuggestionsMode: input?.nodeSuggestionsMode === 'auto' || input?.nodeSuggestionsMode === 'manual'
        ? input.nodeSuggestionsMode as PlaybookDesignSettings['nodeSuggestionsMode']
        : 'inherit',
      approvalSuggestionMode: input?.approvalSuggestionMode === 'auto' || input?.approvalSuggestionMode === 'manual'
        ? input.approvalSuggestionMode as PlaybookDesignSettings['approvalSuggestionMode']
        : 'inherit',
    };
  }

  mergePlaybookSettingsPatch(
    current: Partial<PlaybookDesignSettings> | Record<string, unknown> | null | undefined,
    patch: UpdatePlaybookDesignSettingsDto | undefined,
  ): PlaybookDesignSettings {
    const normalizedCurrent = this.normalizePlaybookSettings(current);
    if (!patch) return normalizedCurrent;

    return {
      inferenceModelId: patch.inferenceModelId === undefined ? normalizedCurrent.inferenceModelId : (patch.inferenceModelId?.trim() || null),
      nodeSuggestionsMode: patch.nodeSuggestionsMode ?? normalizedCurrent.nodeSuggestionsMode,
      approvalSuggestionMode: patch.approvalSuggestionMode ?? normalizedCurrent.approvalSuggestionMode,
    };
  }

  async validatePlaybookSettingsPatch(patch: UpdatePlaybookDesignSettingsDto | undefined): Promise<void> {
    const inferenceModelId = patch?.inferenceModelId?.trim();
    if (!inferenceModelId) return;

    const validation = await this.modelsService.validateModelActive(inferenceModelId);
    if (!validation.valid) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST);
    }
  }

  async resolveEffectiveSettings(playbookSettings?: Partial<PlaybookDesignSettings> | Record<string, unknown> | null): Promise<EffectivePlaybookDesignSettings> {
    const adminSettings = await this.getAdminSettings();
    const normalized = this.normalizePlaybookSettings(playbookSettings);
    const resolvedInferenceModelId = normalized.inferenceModelId || adminSettings.inferenceModelId || null;

    return {
      inferenceModelId: resolvedInferenceModelId,
      nodeSuggestionsMode: normalized.nodeSuggestionsMode === 'inherit' ? adminSettings.nodeSuggestionsMode : normalized.nodeSuggestionsMode,
      approvalSuggestionMode: normalized.approvalSuggestionMode === 'inherit' ? adminSettings.approvalSuggestionMode : normalized.approvalSuggestionMode,
      resolvedInferenceModelId,
    };
  }

  async resolveInferenceModel(playbookSettings?: Partial<PlaybookDesignSettings> | Record<string, unknown> | null): Promise<string> {
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
    if (!fallbackIdentifier) {
      throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR);
    }

    return fallbackIdentifier;
  }

  getDefaultAdminSettings(): AdminPlaybookSettings {
    return { ...DEFAULT_ADMIN_PLAYBOOK_SETTINGS };
  }
}

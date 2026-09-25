import { Inject, Injectable } from '@nestjs/common';
import { ModelsService } from '@modules/models/models.service';
import { BadRequestException, ErrorCode } from '@modules/exceptions';
import { UpdateEvaluationSettingsDto } from '../dto/update-evaluation-settings.dto';
import {
  EVALUATION_SETTINGS_STORE,
  type EvaluationSettingsStore,
} from '../persistence/evaluation-settings.store';

export type EvaluationMode = 'informative' | 'corrective_transparent' | 'corrective_guarded';
export type CorrectionFailureBehavior = 'publish_with_warning' | 'abstain' | 'require_human_review';

export interface ResponseCorrectionSettings {
  threshold: number;
  maxAttempts: number;
  maxDurationMs: number;
  allowAdditionalDocumentRetrieval: boolean;
  allowConnectorQueries: boolean;
  allowCalculationReruns: boolean;
  failureBehavior: CorrectionFailureBehavior;
  showOriginalAnswer: boolean;
}

export interface ResponseReliabilitySettings {
  enabled: boolean;
  mode: EvaluationMode;
  judgeModelId: string | null;
  maxConcurrentEvaluations: number;
  timeoutMs: number;
  maxFindings: number;
  correction: ResponseCorrectionSettings;
}

export interface AdminEvaluationSettings {
  responseReliability: ResponseReliabilitySettings;
}

export const DEFAULT_RESPONSE_CORRECTION_SETTINGS: ResponseCorrectionSettings = {
  threshold: 70,
  maxAttempts: 1,
  maxDurationMs: 60_000,
  allowAdditionalDocumentRetrieval: false,
  allowConnectorQueries: false,
  allowCalculationReruns: false,
  failureBehavior: 'publish_with_warning',
  showOriginalAnswer: true,
};

export const DEFAULT_ADMIN_EVALUATION_SETTINGS: AdminEvaluationSettings = {
  responseReliability: {
    enabled: false,
    mode: 'informative',
    judgeModelId: null,
    maxConcurrentEvaluations: 3,
    timeoutMs: 30_000,
    maxFindings: 5,
    correction: DEFAULT_RESPONSE_CORRECTION_SETTINGS,
  },
};

function isEvaluationMode(value: unknown): value is EvaluationMode {
  return value === 'informative'
    || value === 'corrective_transparent'
    || value === 'corrective_guarded';
}

function normalizeSettings(value?: Partial<AdminEvaluationSettings>): AdminEvaluationSettings {
  const requestedMode = value?.responseReliability?.mode;
  const mode: EvaluationMode = requestedMode === 'corrective_transparent' || requestedMode === 'corrective_guarded'
    ? requestedMode
    : 'informative';
  return {
    responseReliability: {
      ...DEFAULT_ADMIN_EVALUATION_SETTINGS.responseReliability,
      ...value?.responseReliability,
      judgeModelId: value?.responseReliability?.judgeModelId?.toString() || null,
      mode,
      correction: {
        ...DEFAULT_RESPONSE_CORRECTION_SETTINGS,
        ...value?.responseReliability?.correction,
      },
    },
  };
}

@Injectable()
export class EvaluationSettingsService {
  constructor(
    @Inject(EVALUATION_SETTINGS_STORE)
    private readonly settings: EvaluationSettingsStore,
    private readonly modelsService: ModelsService,
  ) { }

  async getSettings(): Promise<AdminEvaluationSettings> {
    const existing = await this.settings.find();
    return normalizeSettings(existing ?? undefined);
  }

  async updateSettings(input: UpdateEvaluationSettingsDto): Promise<AdminEvaluationSettings> {
    const next = normalizeSettings(input);
    const correction = next.responseReliability.correction;
    if (next.responseReliability.mode === 'corrective_guarded') {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Corrective guarded mode is not available yet.');
    }
    if (correction.allowAdditionalDocumentRetrieval) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Additional document retrieval is not available in this MVP.');
    }
    if (correction.allowConnectorQueries) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Connector queries are not available in this MVP.');
    }
    if (correction.allowCalculationReruns) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Calculation reruns are not available in this MVP.');
    }
    if (next.responseReliability.enabled) {
      const modelId = next.responseReliability.judgeModelId;
      if (!modelId) {
        throw new BadRequestException(ErrorCode.BAD_REQUEST, 'A judge model is required when answer reliability is enabled');
      }

      const validation = await this.modelsService.validateModelActive(modelId);
      const compatible = validation.model?.types.some((type) => type === 'chat' || type === 'completion');
      if (!validation.valid || !compatible) {
        throw new BadRequestException(ErrorCode.BAD_REQUEST, 'The selected judge model is missing, inactive, or incompatible');
      }
    }

    await this.settings.upsert(next);
    return normalizeSettings(await this.settings.find() ?? undefined);
  }
}

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ModelsService } from '@modules/models/models.service';
import { BadRequestException, ErrorCode } from '@modules/exceptions';
import { UpdateEvaluationSettingsDto } from '../dto/update-evaluation-settings.dto';
import {
  EvaluationSettings,
  EvaluationSettingsDocument,
} from '../schemas/evaluation-settings.schema';

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
    @InjectModel(EvaluationSettings.name)
    private readonly settingsModel: Model<EvaluationSettingsDocument>,
    private readonly modelsService: ModelsService,
  ) {}

  async getSettings(): Promise<AdminEvaluationSettings> {
    const existing = await this.settingsModel.findOne({ key: 'global' }).lean().exec();
    return normalizeSettings(existing as Partial<AdminEvaluationSettings> | undefined);
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

    const saved = await this.settingsModel
      .findOneAndUpdate(
        { key: 'global' },
        { $set: { key: 'global', responseReliability: next.responseReliability } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean()
      .exec();
    return normalizeSettings(saved as Partial<AdminEvaluationSettings>);
  }
}

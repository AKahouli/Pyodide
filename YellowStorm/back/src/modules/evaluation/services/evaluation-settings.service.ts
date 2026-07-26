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

export type EvaluationMode = 'informative';

export interface ResponseReliabilitySettings {
  enabled: boolean;
  mode: EvaluationMode;
  judgeModelId: string | null;
  maxConcurrentEvaluations: number;
  timeoutMs: number;
  maxFindings: number;
}

export interface AdminEvaluationSettings {
  responseReliability: ResponseReliabilitySettings;
}

export const DEFAULT_ADMIN_EVALUATION_SETTINGS: AdminEvaluationSettings = {
  responseReliability: {
    enabled: false,
    mode: 'informative',
    judgeModelId: null,
    maxConcurrentEvaluations: 3,
    timeoutMs: 30_000,
    maxFindings: 5,
  },
};

function normalizeSettings(value?: Partial<AdminEvaluationSettings>): AdminEvaluationSettings {
  return {
    responseReliability: {
      ...DEFAULT_ADMIN_EVALUATION_SETTINGS.responseReliability,
      ...value?.responseReliability,
      judgeModelId: value?.responseReliability?.judgeModelId?.toString() || null,
      mode: 'informative',
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

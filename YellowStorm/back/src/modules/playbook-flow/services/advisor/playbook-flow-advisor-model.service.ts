import { Injectable } from '@nestjs/common';
import type { AdvisorScoringMode } from '../../models/playbook-flow.model';
import {
  PlaybookFlowSettingsService,
  type ResolvedEvaluationModelConfig,
} from '../playbook-flow-settings.service';

@Injectable()
export class PlaybookFlowAdvisorModelService {
  constructor(private readonly settingsService: PlaybookFlowSettingsService) {}

  async resolveEvaluationModel(_scoringMode: AdvisorScoringMode): Promise<string> {
    return this.settingsService.resolveAdvisorEvaluationModelId();
  }

  async resolveEvaluationModelConfig(_scoringMode: AdvisorScoringMode): Promise<ResolvedEvaluationModelConfig> {
    return this.settingsService.resolveAdvisorEvaluationModelConfig();
  }

  async resolveReplayEvaluationModel(): Promise<string> {
    return this.settingsService.resolveReplayEvaluationModelId();
  }
}

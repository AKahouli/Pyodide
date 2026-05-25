import { Injectable } from '@nestjs/common';
import type { AdvisorScoringMode } from '../../schemas/playbook-flow.schema';
import { PlaybookFlowSettingsService } from '../playbook-flow-settings.service';

@Injectable()
export class PlaybookFlowAdvisorModelService {
  constructor(private readonly settingsService: PlaybookFlowSettingsService) {}

  async resolveEvaluationModel(_scoringMode: AdvisorScoringMode): Promise<string> {
    return this.settingsService.resolveAdvisorEvaluationModelId();
  }
}

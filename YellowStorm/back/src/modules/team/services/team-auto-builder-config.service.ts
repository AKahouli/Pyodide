import { Inject, Injectable } from '@nestjs/common';
import { LoggerService } from '../../logger';
import { TEAM_AUTO_BUILDER_STORE, type TeamAutoBuilderConfigRow, type TeamAutoBuilderStore } from '../persistence/team.store';
import { ITeamAutoBuilderConfigResponse } from '../interfaces/team-auto-builder-config.interface';
import { UpsertAutoBuilderConfigDto } from '../dto/upsert-auto-builder-config.dto';

@Injectable()
export class TeamAutoBuilderConfigService {
  constructor(
    @Inject(TEAM_AUTO_BUILDER_STORE)
    private readonly configStore: TeamAutoBuilderStore,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(TeamAutoBuilderConfigService.name);
  }

  async getConfig(): Promise<ITeamAutoBuilderConfigResponse | null> {
    const row = await this.configStore.find();
    if (!row) return null;
    return this.toResponse(row);
  }

  async upsertConfig(dto: UpsertAutoBuilderConfigDto): Promise<ITeamAutoBuilderConfigResponse> {
    const row = await this.configStore.upsert(dto);

    this.logger.log('Team auto-builder config updated', {
      modelId: dto.modelId,
      isEnabled: dto.isEnabled,
    });

    return this.toResponse(row);
  }

  private toResponse(row: TeamAutoBuilderConfigRow & { updatedAt: Date }): ITeamAutoBuilderConfigResponse {
    return {
      modelId: row.modelId,
      systemPrompt: row.systemPrompt,
      temperature: row.temperature,
      isEnabled: row.isEnabled,
      updatedAt: row.updatedAt,
    };
  }
}

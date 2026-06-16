import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '../../logger';
import {
  TeamAutoBuilderConfig,
  TeamAutoBuilderConfigDocument,
} from '../schemas/team-auto-builder-config.schema';
import { ITeamAutoBuilderConfigResponse } from '../interfaces/team-auto-builder-config.interface';
import { UpsertAutoBuilderConfigDto } from '../dto/upsert-auto-builder-config.dto';

@Injectable()
export class TeamAutoBuilderConfigService {
  constructor(
    @InjectModel(TeamAutoBuilderConfig.name)
    private readonly configModel: Model<TeamAutoBuilderConfigDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(TeamAutoBuilderConfigService.name);
  }

  async getConfig(): Promise<ITeamAutoBuilderConfigResponse | null> {
    const doc = await this.configModel.findOne({}).lean().exec();
    if (!doc) return null;
    return this.toResponse(doc);
  }

  async upsertConfig(dto: UpsertAutoBuilderConfigDto): Promise<ITeamAutoBuilderConfigResponse> {
    const doc = await this.configModel
      .findOneAndUpdate({}, { $set: dto }, { upsert: true, new: true })
      .lean()
      .exec();

    this.logger.log('Team auto-builder config updated', {
      modelId: dto.modelId,
      isEnabled: dto.isEnabled,
    });

    return this.toResponse(doc!);
  }

  private toResponse(doc: Record<string, unknown>): ITeamAutoBuilderConfigResponse {
    return {
      modelId: doc.modelId as string,
      systemPrompt: doc.systemPrompt as string,
      temperature: doc.temperature as number,
      isEnabled: doc.isEnabled as boolean,
      updatedAt: doc.updatedAt as Date,
    };
  }
}

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GovernanceMetric, GovernanceMetricDocument } from '../schemas/governance-metric.schema';
import { GovernanceProgramService } from './governance-program.service';
import { GovernanceAccessService } from './governance-access.service';

export interface GovernanceMetricResponse {
  id: string;
  programId: string;
  scopeId?: string;
  deploymentId?: string;
  agentId?: string;
  channel?: string;
  type: string;
  value: number;
  dimensions: Record<string, string>;
  periodStart: string;
  periodEnd: string;
}

@Injectable()
export class GovernanceMetricService {
  constructor(
    @InjectModel(GovernanceMetric.name) private readonly metricModel: Model<GovernanceMetricDocument>,
    private readonly programService: GovernanceProgramService,
    private readonly accessService: GovernanceAccessService,
  ) {}

  async list(actorId: string, programId: string): Promise<GovernanceMetricResponse[]> {
    await this.programService.assertOwnedProgram(actorId, programId);
    const accessibleScopeIds = await this.accessService.getAccessibleScopeIds(actorId, programId);
    const filter = accessibleScopeIds.includes('*')
      ? { programId: new Types.ObjectId(programId) }
      : { programId: new Types.ObjectId(programId), scopeId: { $in: accessibleScopeIds.map((id) => new Types.ObjectId(id)) } };
    const metrics = await this.metricModel.find(filter).sort({ periodStart: -1 }).limit(100).lean().exec();
    return metrics.map((metric) => ({
      id: metric._id.toString(),
      programId: metric.programId.toString(),
      scopeId: metric.scopeId?.toString(),
      deploymentId: metric.deploymentId?.toString(),
      agentId: metric.agentId?.toString(),
      channel: metric.channel,
      type: metric.type,
      value: metric.value,
      dimensions: metric.dimensions ?? {},
      periodStart: metric.periodStart.toISOString(),
      periodEnd: metric.periodEnd.toISOString(),
    }));
  }
}

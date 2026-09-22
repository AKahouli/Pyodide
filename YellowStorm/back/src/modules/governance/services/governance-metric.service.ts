import { Inject, Injectable } from '@nestjs/common';
import { METRIC_STORE, type MetricStore } from '../persistence/metric-store';
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
    @Inject(METRIC_STORE) private readonly metricStore: MetricStore,
    private readonly programService: GovernanceProgramService,
    private readonly accessService: GovernanceAccessService,
  ) {}

  async list(actorId: string, programId: string): Promise<GovernanceMetricResponse[]> {
    await this.programService.assertOwnedProgram(actorId, programId);
    const accessibleScopeIds = await this.accessService.getAccessibleScopeIds(actorId, programId);
    const metrics = await this.metricStore.listForProgramScopes(programId, accessibleScopeIds.includes('*') ? '*' : accessibleScopeIds, 100);
    return metrics.map((metric) => ({
      id: metric.id,
      programId: metric.programId,
      scopeId: metric.scopeId,
      deploymentId: metric.deploymentId,
      agentId: metric.agentId,
      channel: metric.channel,
      type: metric.type,
      value: metric.value,
      dimensions: metric.dimensions ?? {},
      periodStart: metric.periodStart.toISOString(),
      periodEnd: metric.periodEnd.toISOString(),
    }));
  }
}

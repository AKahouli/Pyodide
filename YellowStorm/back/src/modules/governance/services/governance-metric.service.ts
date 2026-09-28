import { Injectable } from '@nestjs/common';
import { GovernanceProgramService } from './governance-program.service';
import { GovernanceAccessService } from './governance-access.service';
import { PgMetricStore } from '../persistence/postgres/pg-metric.store';

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
    private readonly metricStore: PgMetricStore,
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

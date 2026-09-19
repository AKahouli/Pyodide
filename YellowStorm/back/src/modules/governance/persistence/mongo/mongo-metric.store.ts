import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GovernanceMetric, GovernanceMetricDocument } from './schemas/governance-metric.schema';
import { METRIC_STORE, type MetricStore } from '../metric-store';
import type { GovernanceMetricRecord } from '../governance-records';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export function metricToRecord(doc: Row): GovernanceMetricRecord {
  return {
    id: doc._id.toString(),
    programId: doc.programId.toString(),
    scopeId: doc.scopeId?.toString(),
    deploymentId: doc.deploymentId?.toString(),
    agentId: doc.agentId?.toString(),
    channel: doc.channel,
    type: doc.type,
    value: doc.value,
    dimensions: doc.dimensions ?? {},
    periodStart: doc.periodStart,
    periodEnd: doc.periodEnd,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

@Injectable()
export class MongoMetricStore implements MetricStore {
  constructor(@InjectModel(GovernanceMetric.name) private readonly model: Model<GovernanceMetricDocument>) {}

  async listForProgramScopes(programId: string, scopeIds: string[] | '*', limit: number): Promise<GovernanceMetricRecord[]> {
    const filter = scopeIds === '*' ? { programId: new Types.ObjectId(programId) } : { programId: new Types.ObjectId(programId), scopeId: { $in: scopeIds.map((id) => new Types.ObjectId(id)) } };
    const metrics = await this.model.find(filter).sort({ periodStart: -1 }).limit(limit).lean().exec();
    return metrics.map(metricToRecord);
  }

  async listByProgramAndScope(programId: string, scopeId: string): Promise<GovernanceMetricRecord[]> {
    const metrics = await this.model
      .find({ programId: new Types.ObjectId(programId), scopeId: new Types.ObjectId(scopeId) })
      .lean()
      .exec();
    return metrics.map(metricToRecord);
  }

  async deleteByProgramAndScope(programId: string, scopeId: string): Promise<void> {
    await this.model.deleteMany({ programId: new Types.ObjectId(programId), scopeId: new Types.ObjectId(scopeId) }).exec();
  }
}

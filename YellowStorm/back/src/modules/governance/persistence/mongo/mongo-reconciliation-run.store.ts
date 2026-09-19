import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GovernanceReconciliationRun, GovernanceReconciliationRunDocument } from './schemas/governance-reconciliation-run.schema';
import { RECONCILIATION_RUN_STORE, type ReconciliationRunLeaseClaim, type ReconciliationRunStore } from '../reconciliation-run-store';
import type { GovernanceReconciliationRunRecord } from '../governance-records';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export function runToRecord(doc: Row): GovernanceReconciliationRunRecord {
  return {
    id: doc._id.toString(),
    bindingId: doc.bindingId.toString(),
    status: doc.status,
    dryRun: doc.dryRun,
    cursor: doc.cursor,
    stats: doc.stats ?? {},
    errors: doc.errors ?? [],
    startedAt: doc.startedAt,
    completedAt: doc.completedAt,
    leaseToken: doc.leaseToken,
    leaseExpiresAt: doc.leaseExpiresAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

@Injectable()
export class MongoReconciliationRunStore implements ReconciliationRunStore {
  constructor(@InjectModel(GovernanceReconciliationRun.name) private readonly model: Model<GovernanceReconciliationRunDocument>) {}

  async create(input: { bindingId: string; dryRun: boolean }): Promise<GovernanceReconciliationRunRecord> {
    const run = await this.model.create({ bindingId: new Types.ObjectId(input.bindingId), dryRun: input.dryRun, status: 'pending', stats: {}, errors: [] });
    return runToRecord(run);
  }

  async findById(runId: string): Promise<GovernanceReconciliationRunRecord | null> {
    const found = await this.model.findById(runId).exec();
    return found ? runToRecord(found) : null;
  }

  async findByIdAndBinding(bindingId: string, runId: string): Promise<GovernanceReconciliationRunRecord | null> {
    const found = await this.model.findOne({ _id: new Types.ObjectId(runId), bindingId: new Types.ObjectId(bindingId) }).exec();
    return found ? runToRecord(found) : null;
  }

  async claim(runId: string, now: Date, leaseMs: number): Promise<ReconciliationRunLeaseClaim | null> {
    const leaseToken = randomUUID();
    const run = await this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(runId), $or: [{ status: { $in: ['pending', 'failed'] } }, { status: 'running', leaseExpiresAt: { $lt: now } }] },
        { $set: { status: 'running', startedAt: now, leaseToken, leaseExpiresAt: new Date(now.getTime() + leaseMs) } },
        { new: true },
      )
      .exec();
    return run ? { run: runToRecord(run), leaseToken } : null;
  }

  async renewLease(runId: string, leaseToken: string, leaseMs: number): Promise<boolean> {
    const result = await this.model.updateOne({ _id: new Types.ObjectId(runId), leaseToken, status: 'running' }, { $set: { leaseExpiresAt: new Date(Date.now() + leaseMs) } }).exec();
    return result.modifiedCount === 1;
  }

  async checkpoint(runId: string, leaseToken: string, cursor: string, stats: Record<string, number>, errors: GovernanceReconciliationRunRecord['errors'], leaseMs: number): Promise<boolean> {
    const update = await this.model
      .updateOne({ _id: new Types.ObjectId(runId), leaseToken, status: 'running' }, { $set: { cursor, stats, errors, leaseExpiresAt: new Date(Date.now() + leaseMs) } })
      .exec();
    return update.modifiedCount === 1;
  }

  async completeIfLeased(runId: string, leaseToken: string, stats: Record<string, number>, errors: GovernanceReconciliationRunRecord['errors']): Promise<GovernanceReconciliationRunRecord | null> {
    const updated = await this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(runId), leaseToken, status: 'running' },
        { $set: { status: 'completed', stats, errors, completedAt: new Date() }, $unset: { cursor: '', leaseToken: '', leaseExpiresAt: '' } },
        { new: true },
      )
      .exec();
    return updated ? runToRecord(updated) : null;
  }

  async failIfLeased(runId: string, leaseToken: string, errors: GovernanceReconciliationRunRecord['errors']): Promise<GovernanceReconciliationRunRecord | null> {
    const updated = await this.model
      .findOneAndUpdate({ _id: new Types.ObjectId(runId), leaseToken }, { $set: { status: 'failed', errors }, $unset: { leaseToken: '', leaseExpiresAt: '' } }, { new: true })
      .exec();
    return updated ? runToRecord(updated) : null;
  }
}

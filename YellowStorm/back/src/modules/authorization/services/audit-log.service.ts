import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, FilterQuery } from 'mongoose';
import { AuditLog, AuditLogDocument } from '../schemas/audit-log.schema';
import { LoggerService } from '../../logger';
import {
  CreateAuditLogParams,
  AuditLogQueryParams,
  AuditLogResponse,
  IAuditLog,
} from '../interfaces/audit-log.interface';
import { escapeRegex } from '../../../common/utils';

@Injectable()
export class AuditLogService {
  constructor(
    @InjectModel(AuditLog.name) private readonly auditLogModel: Model<AuditLogDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(AuditLogService.name);
  }

  /**
   * Logs an admin action asynchronously.
   * Fire-and-forget: returns immediately, logs errors but doesn't throw.
   *
   * @param params - The audit log parameters
   */
  logAction(params: CreateAuditLogParams): void {
    // Fire and forget - don't await
    this.saveAuditLog(params).catch((error) => {
      // Log error but don't propagate - audit logging should never fail the main operation
      this.logger.error('Failed to write audit log', {
        error: error.message,
        action: params.action,
        actorId: params.actorId,
      });
    });
  }

  /**
   * Logs a successful action.
   */
  logSuccess(params: Omit<CreateAuditLogParams, 'status' | 'failureReason'>): void {
    this.logAction({ ...params, status: 'success' });
  }

  /**
   * Logs a failed action.
   */
  logFailure(
    params: Omit<CreateAuditLogParams, 'status'> & { failureReason: string },
  ): void {
    this.logAction({ ...params, status: 'failure' });
  }

  /**
   * Queries audit logs with filtering and pagination.
   */
  async findAll(params: AuditLogQueryParams): Promise<{
    logs: AuditLogResponse[];
    total: number;
    hasMore: boolean;
  }> {
    const filter: FilterQuery<AuditLogDocument> = {};

    if (params.actorId) {
      filter.actorId = new Types.ObjectId(params.actorId);
    }
    if (params.actorEmail) {
      filter.actorEmail = { $regex: escapeRegex(params.actorEmail), $options: 'i' };
    }
    if (params.action) {
      filter.action = params.action;
    }
    if (params.feature) {
      // Filter by action prefix (e.g., "users" matches "users.suspend", "users.activate")
      filter.action = { $regex: `^${escapeRegex(params.feature)}\\.`, $options: 'i' };
    }
    if (params.targetType) {
      filter.targetType = params.targetType;
    }
    if (params.status) {
      filter.status = params.status;
    }
    if (params.startDate || params.endDate) {
      filter.createdAt = {};
      if (params.startDate) {
        filter.createdAt.$gte = params.startDate;
      }
      if (params.endDate) {
        filter.createdAt.$lte = params.endDate;
      }
    }

    const limit = params.limit ?? 50;
    const skip = params.skip ?? 0;

    const [logs, total] = await Promise.all([
      this.auditLogModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.auditLogModel.countDocuments(filter),
    ]);

    return {
      logs: logs.map((log) => this.toAuditLogResponse(log)),
      total,
      hasMore: skip + logs.length < total,
    };
  }

  /**
   * Gets distinct action values (for filter dropdowns).
   */
  async getDistinctActions(): Promise<string[]> {
    return this.auditLogModel.distinct('action').exec();
  }

  /**
   * Gets distinct features (action namespaces) for filtering.
   */
  async getDistinctFeatures(): Promise<string[]> {
    const actions = await this.getDistinctActions();
    const features = new Set<string>();
    for (const action of actions) {
      const parts = action.split('.');
      if (parts.length >= 1) {
        features.add(parts[0]);
      }
    }
    return Array.from(features).sort((a, b) => a.localeCompare(b));
  }

  /**
   * Gets audit logs for a specific target.
   */
  async findByTarget(
    targetType: string,
    targetId: string,
    limit = 50,
  ): Promise<AuditLogResponse[]> {
    const logs = await this.auditLogModel
      .find({
        targetType,
        targetId: new Types.ObjectId(targetId),
      })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return logs.map((log) => this.toAuditLogResponse(log));
  }

  /**
   * Gets audit logs for a specific actor.
   */
  async findByActor(actorId: string, limit = 50): Promise<AuditLogResponse[]> {
    const logs = await this.auditLogModel
      .find({ actorId: new Types.ObjectId(actorId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return logs.map((log) => this.toAuditLogResponse(log));
  }

  // ==================== Private Methods ====================

  private async saveAuditLog(params: CreateAuditLogParams): Promise<void> {
    await this.auditLogModel.create({
      actorId: new Types.ObjectId(params.actorId),
      actorEmail: params.actorEmail,
      action: params.action,
      targetId: params.targetId ? new Types.ObjectId(params.targetId) : undefined,
      targetType: params.targetType,
      metadata: params.metadata,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      status: params.status,
      failureReason: params.failureReason,
    });
  }

  private toAuditLogResponse(log: IAuditLog): AuditLogResponse {
    return {
      id: log._id.toString(),
      actorId: log.actorId.toString(),
      actorEmail: log.actorEmail,
      action: log.action,
      targetId: log.targetId?.toString(),
      targetType: log.targetType,
      metadata: log.metadata,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      status: log.status,
      failureReason: log.failureReason,
      createdAt: log.createdAt,
    };
  }
}

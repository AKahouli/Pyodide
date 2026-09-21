import { Inject, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { LoggerService } from '../../logger';
import { AUDIT_LOG_STORE, type AuditLogStore } from '../persistence/audit-log.store';
import {
  CreateAuditLogParams,
  AuditLogQueryParams,
  AuditLogResponse,
} from '../interfaces/audit-log.interface';
import type { AuditLogRecord } from '../persistence/audit-log.store';
import { escapeRegex } from '../../../common/utils';

@Injectable()
export class AuditLogService {
  constructor(
    @Inject(AUDIT_LOG_STORE) private readonly auditLogStore: AuditLogStore,
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
    const limit = params.limit ?? 50;
    const skip = params.skip ?? 0;

    const { logs, total, hasMore } = await this.auditLogStore.findAll({
      actorId: params.actorId,
      actorEmail: params.actorEmail,
      action: params.action,
      feature: params.feature,
      targetType: params.targetType,
      status: params.status,
      startDate: params.startDate,
      endDate: params.endDate,
      skip,
      limit,
    });

    return {
      logs: logs.map((log) => this.toAuditLogResponse(log)),
      total,
      hasMore,
    };
  }

  /**
   * Gets distinct action values (for filter dropdowns).
   */
  async getDistinctActions(): Promise<string[]> {
    return this.auditLogStore.getDistinctActions();
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
    const { logs } = await this.auditLogStore.findAll({ targetType, targetId, limit });
    return logs.map((log) => this.toAuditLogResponse(log));
  }

  /**
   * Gets audit logs for a specific actor.
   */
  async findByActor(actorId: string, limit = 50): Promise<AuditLogResponse[]> {
    const { logs } = await this.auditLogStore.findAll({ actorId, limit });
    return logs.map((log) => this.toAuditLogResponse(log));
  }

  // ==================== Private Methods ====================

  private async saveAuditLog(params: CreateAuditLogParams): Promise<void> {
    await this.auditLogStore.insert({
      actorId: params.actorId,
      actorEmail: params.actorEmail,
      action: params.action,
      targetId: params.targetId ?? null,
      targetType: params.targetType ?? null,
      metadata: params.metadata ?? null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
      status: params.status,
      failureReason: params.failureReason ?? null,
    });
  }

  private toAuditLogResponse(log: AuditLogRecord): AuditLogResponse {
    return {
      id: log.id,
      actorId: log.actorId,
      actorEmail: log.actorEmail,
      action: log.action,
      targetId: log.targetId ?? undefined,
      targetType: log.targetType ?? undefined,
      metadata: log.metadata ?? undefined,
      ipAddress: log.ipAddress ?? undefined,
      userAgent: log.userAgent ?? undefined,
      status: log.status,
      failureReason: log.failureReason ?? undefined,
      createdAt: log.createdAt,
    };
  }
}

import { Injectable } from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { LoggerService } from '../../logger';
import { WorkyAuditRepository } from '../persistence/worky-audit.repository';

export interface WorkyAuditAppendInput {
  streamId: string;
  actorUserId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Append-only audit log for every state mutation in the Worky module.
 * Backed by `worky.audit_events`; rows are never updated, and only leave with the
 * stream they belong to. The governance engine (Part 3) also writes one row per
 * gate evaluation, even for `off`-level evaluations (canonical §5.3).
 */
@Injectable()
export class WorkyAuditService {
  constructor(
    private readonly audits: WorkyAuditRepository,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyAuditService.name);
  }

  async append(input: WorkyAuditAppendInput): Promise<void> {
    if (!isObjectId(input.streamId)) {
      throw new Error(`WorkyAuditService.append: invalid streamId ${input.streamId}`);
    }
    await this.audits.append(input);
    this.logger.debug('Worky audit event recorded', {
      streamId: input.streamId,
      action: input.action,
    });
  }
}

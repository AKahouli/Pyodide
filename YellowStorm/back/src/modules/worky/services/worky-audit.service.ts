import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WorkyAuditEvent,
  WorkyAuditEventDocument,
} from '../schemas/worky-audit-event.schema';
import { LoggerService } from '../../logger';

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
 * Backed by `worky_audit_events`; rows are never updated or deleted. The
 * governance engine (Part 3) also writes one row per gate evaluation, even
 * for `off`-level evaluations (canonical §5.3).
 */
@Injectable()
export class WorkyAuditService {
  constructor(
    @InjectModel(WorkyAuditEvent.name)
    private readonly model: Model<WorkyAuditEventDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyAuditService.name);
  }

  async append(input: WorkyAuditAppendInput): Promise<void> {
    if (!Types.ObjectId.isValid(input.streamId)) {
      throw new Error(`WorkyAuditService.append: invalid streamId ${input.streamId}`);
    }
    await this.model.create({
      streamId: new Types.ObjectId(input.streamId),
      actorUserId:
        input.actorUserId && Types.ObjectId.isValid(input.actorUserId)
          ? new Types.ObjectId(input.actorUserId)
          : null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId:
        input.targetId && Types.ObjectId.isValid(input.targetId)
          ? new Types.ObjectId(input.targetId)
          : null,
      details: input.details ?? {},
    });
    this.logger.debug('Worky audit event recorded', {
      streamId: input.streamId,
      action: input.action,
    });
  }
}

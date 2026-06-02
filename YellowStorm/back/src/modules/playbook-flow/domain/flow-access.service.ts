import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { ErrorCode } from '../../exceptions/constants/error-codes';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '../../exceptions/exceptions/http.exceptions';
import { Flow, FlowDocument } from '../schemas/playbook-flow.schema';

@Injectable()
/**
 * Centralizes playbook flow lookup, ownership checks, and optimistic timestamp
 * validation so write paths share the same access semantics.
 */
export class FlowAccessService {
  constructor(@InjectModel(Flow.name) private readonly flowModel: Model<FlowDocument>) {}

  async findById(flowId: string): Promise<FlowDocument> {
    if (!Types.ObjectId.isValid(flowId)) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    }

    const flow = await this.flowModel.findById(flowId);
    if (!flow) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook flow not found');
    }
    return flow;
  }

  async findOwnedFlow(flowId: string, ownerId: string): Promise<FlowDocument> {
    const flow = await this.findById(flowId);
    if (String(flow.ownerId) !== String(ownerId)) {
      throw new ForbiddenException(ErrorCode.FORBIDDEN, 'You do not have access to this flow');
    }
    return flow;
  }

  ensureExpectedUpdatedAt(existingUpdatedAt: Date | undefined, expectedUpdatedAtRaw: string, message: string): void {
    const expectedUpdatedAt = Date.parse(expectedUpdatedAtRaw);
    if (Number.isNaN(expectedUpdatedAt)) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Invalid expectedUpdatedAt');
    }
    if (existingUpdatedAt instanceof Date && existingUpdatedAt.getTime() !== expectedUpdatedAt) {
      throw new ConflictException(ErrorCode.CONFLICT, message);
    }
  }
}

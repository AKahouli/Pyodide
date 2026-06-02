import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { NotFoundException } from '@modules/exceptions';
import { FlowExecution, FlowExecutionDocument } from '../schemas/playbook-flow-execution.schema';

/** Reads per-execution HITL audit and pending interrupt state for run-mode UI and replay consumers. */
@Injectable()
export class PlaybookFlowHitlContextService {
  constructor(
    @InjectModel(FlowExecution.name) private readonly executionModel: Model<FlowExecutionDocument>,
  ) {}

  async listExecutionEvents(executionId: string, ownerId: string): Promise<unknown[]> {
    const execution = await this.findOwnedExecution(executionId, ownerId);
    return execution.hitlEvents ?? [];
  }

  async getPendingInterrupt(executionId: string, ownerId: string): Promise<unknown | null> {
    const execution = await this.findOwnedExecution(executionId, ownerId);
    return execution.pendingApproval ?? null;
  }

  async getPendingBlocker(executionId: string, ownerId: string, interruptId: string): Promise<{ flowId: string; blockerId: string } | null> {
    const execution = await this.findOwnedExecution(executionId, ownerId);
    const pending = execution.pendingApproval;
    if (pending?.interruptId !== interruptId || !pending.blockerRuleId) return null;
    return { flowId: execution.flowId, blockerId: pending.blockerRuleId };
  }

  private async findOwnedExecution(executionId: string, ownerId: string): Promise<FlowExecutionDocument> {
    const execution = await this.executionModel.findOne({ _id: executionId, ownerId });
    if (!execution) throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND, 'Execution not found');
    return execution;
  }
}

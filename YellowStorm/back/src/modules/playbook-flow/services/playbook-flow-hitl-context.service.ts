import { Injectable } from '@nestjs/common';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { NotFoundException } from '@modules/exceptions';
import { ExecutionRepository, type ExecutionRecord } from '../persistence/execution.repository';

/** Reads per-execution HITL audit and pending interrupt state for run-mode UI and replay consumers. */
@Injectable()
export class PlaybookFlowHitlContextService {
  constructor(
    private readonly executionRepository: ExecutionRepository,
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

  private async findOwnedExecution(executionId: string, ownerId: string): Promise<ExecutionRecord> {
    const execution = await this.executionRepository.findOwned(executionId, ownerId);
    if (!execution) throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_EXECUTION_NOT_FOUND, 'Execution not found');
    return execution;
  }
}

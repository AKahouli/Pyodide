import { Injectable } from '@nestjs/common';
import {
  CreateHitlBlockerDto,
  CreateHitlMemoryDto,
  NormalizeHitlBlockerDto,
  UpdateHitlBlockerDto,
  UpdateHitlMemoryDto,
  UpdateHitlPolicyDto,
} from '../dto/playbook-flow-hitl.dto';
import { FlowHitlMemory } from '../schemas/playbook-flow-hitl-memory.schema';
import { HitlBlockerRule, HitlPolicy } from '../schemas/playbook-flow-hitl.schema';
import { PlaybookFlowHitlBlockerService } from './playbook-flow-hitl-blocker.service';
import { PlaybookFlowHitlContextService } from './playbook-flow-hitl-context.service';
import { PlaybookFlowHitlMemoryService } from './playbook-flow-hitl-memory.service';
import { PlaybookFlowHitlPromptService } from './playbook-flow-hitl-prompt.service';
import { PlaybookFlowStreamEventsService } from './playbook-flow-stream-events.service';

/** Facade used by the HITL controller to keep route wiring stable while capabilities live in focused services. */
@Injectable()
export class PlaybookFlowHitlService {
  constructor(
    private readonly blockers: PlaybookFlowHitlBlockerService,
    private readonly context: PlaybookFlowHitlContextService,
    private readonly memory: PlaybookFlowHitlMemoryService,
    private readonly prompts: PlaybookFlowHitlPromptService,
    private readonly streamEvents: PlaybookFlowStreamEventsService,
  ) {}

  getPolicy(flowId: string, ownerId: string): Promise<HitlPolicy> {
    return this.prompts.getPolicy(flowId, ownerId);
  }

  updatePolicy(flowId: string, ownerId: string, dto: UpdateHitlPolicyDto): Promise<HitlPolicy> {
    return this.prompts.updatePolicy(flowId, ownerId, dto as Partial<HitlPolicy>);
  }

  getNodePolicy(flowId: string, ownerId: string, nodeId: string): Promise<HitlPolicy> {
    return this.prompts.getNodePolicy(flowId, ownerId, nodeId);
  }

  updateNodePolicy(flowId: string, ownerId: string, nodeId: string, dto: UpdateHitlPolicyDto): Promise<HitlPolicy> {
    return this.prompts.updateNodePolicy(flowId, ownerId, nodeId, dto as Partial<HitlPolicy>);
  }

  listBlockers(flowId: string, ownerId: string): Promise<HitlBlockerRule[]> {
    return this.blockers.listBlockers(flowId, ownerId);
  }

  createBlocker(flowId: string, ownerId: string, dto: CreateHitlBlockerDto): Promise<HitlBlockerRule> {
    return this.blockers.createBlocker(flowId, ownerId, dto);
  }

  updateBlocker(flowId: string, ownerId: string, blockerId: string, dto: UpdateHitlBlockerDto): Promise<HitlBlockerRule> {
    return this.blockers.updateBlocker(flowId, ownerId, blockerId, dto);
  }

  deleteBlocker(flowId: string, ownerId: string, blockerId: string): Promise<{ deleted: true }> {
    return this.blockers.deleteBlocker(flowId, ownerId, blockerId);
  }

  normalizeBlocker(dto: NormalizeHitlBlockerDto): CreateHitlBlockerDto {
    return this.blockers.normalizeBlocker(dto);
  }

  listMemories(flowId: string, ownerId: string): Promise<FlowHitlMemory[]> {
    return this.memory.listMemories(flowId, ownerId);
  }

  createMemory(flowId: string, ownerId: string, dto: CreateHitlMemoryDto): Promise<FlowHitlMemory> {
    return this.memory.createMemory(flowId, ownerId, dto);
  }

  updateMemory(flowId: string, ownerId: string, memoryId: string, dto: UpdateHitlMemoryDto): Promise<FlowHitlMemory> {
    return this.memory.updateMemory(flowId, ownerId, memoryId, dto);
  }

  deleteMemory(flowId: string, ownerId: string, memoryId: string): Promise<{ deleted: true }> {
    return this.memory.deleteMemory(flowId, ownerId, memoryId);
  }

  listExecutionEvents(executionId: string, ownerId: string): Promise<unknown[]> {
    return this.context.listExecutionEvents(executionId, ownerId);
  }

  getPendingInterrupt(executionId: string, ownerId: string): Promise<unknown | null> {
    return this.context.getPendingInterrupt(executionId, ownerId);
  }

  async disableBlocker(executionId: string, ownerId: string, interruptId: string): Promise<{ disabled: boolean }> {
    const pendingBlocker = await this.context.getPendingBlocker(executionId, ownerId, interruptId);
    if (!pendingBlocker) return { disabled: false };
    await this.blockers.disableBlocker(pendingBlocker.flowId, ownerId, pendingBlocker.blockerId);
    this.streamEvents.emitHitlBlockerDisabled(executionId, pendingBlocker.blockerId, { interruptId });
    return { disabled: true };
  }
}

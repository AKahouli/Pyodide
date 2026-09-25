import { Injectable } from '@nestjs/common';
import { normalizeObjectId } from '@common/postgres';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { NotFoundException } from '@modules/exceptions';
import { CreateHitlMemoryDto, UpdateHitlMemoryDto } from '../dto/playbook-flow-hitl.dto';
import { FlowRepository } from '../persistence/flow.repository';
import { HitlMemoryRepository, toHitlMemoryJson, type HitlMemoryJson } from '../persistence/hitl-memory.repository';

/** Persists user-approved HITL memories separately from per-execution interrupt audit data. */
@Injectable()
export class PlaybookFlowHitlMemoryService {
  constructor(
    private readonly flows: FlowRepository,
    private readonly memories: HitlMemoryRepository,
  ) {}

  async listMemories(flowId: string, ownerId: string): Promise<HitlMemoryJson[]> {
    await this.findOwnedFlow(flowId, ownerId);
    return (await this.memories.listForFlow(flowId, ownerId)).map(toHitlMemoryJson);
  }

  async createMemory(flowId: string, ownerId: string, dto: CreateHitlMemoryDto): Promise<HitlMemoryJson> {
    await this.findOwnedFlow(flowId, ownerId);
    const created = await this.memories.create({
      ownerId,
      flowId,
      nodeId: dto.nodeId ?? null,
      memoryType: dto.memoryType ?? 'procedural',
      source: dto.source ?? 'manual',
      title: dto.title,
      content: dto.content,
      normalizedInstruction: dto.normalizedInstruction,
      appliesTo: dto.appliesTo ?? 'workflow',
      status: dto.status ?? 'draft',
      sensitivity: dto.sensitivity ?? 'normal',
      createdFromExecutionId: dto.createdFromExecutionId,
      createdFromInterruptId: dto.createdFromInterruptId,
    });
    return toHitlMemoryJson(created);
  }

  async updateMemory(flowId: string, ownerId: string, memoryId: string, dto: UpdateHitlMemoryDto): Promise<HitlMemoryJson> {
    await this.findOwnedFlow(flowId, ownerId);
    const updated = await this.memories.update(memoryId, flowId, ownerId, dto);
    if (!updated) throw new NotFoundException(ErrorCode.NOT_FOUND, 'HITL memory not found');
    return toHitlMemoryJson(updated);
  }

  async deleteMemory(flowId: string, ownerId: string, memoryId: string): Promise<{ deleted: true }> {
    await this.findOwnedFlow(flowId, ownerId);
    const deleted = await this.memories.delete(memoryId, flowId, ownerId);
    if (!deleted) throw new NotFoundException(ErrorCode.NOT_FOUND, 'HITL memory not found');
    return { deleted: true };
  }

  private async findOwnedFlow(flowId: string, ownerId: string): Promise<void> {
    const flow = await this.flows.findOwnerRef(flowId);
    if (!flow || typeof ownerId !== 'string' || flow.ownerId !== normalizeObjectId(ownerId)) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook not found');
    }
  }
}

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { NotFoundException } from '@modules/exceptions';
import { CreateHitlMemoryDto, UpdateHitlMemoryDto } from '../dto/playbook-flow-hitl.dto';
import { Flow, FlowDocument } from '../schemas/playbook-flow.schema';
import { FlowHitlMemory, FlowHitlMemoryDocument } from '../schemas/playbook-flow-hitl-memory.schema';

/** Persists user-approved HITL memories separately from per-execution interrupt audit data. */
@Injectable()
export class PlaybookFlowHitlMemoryService {
  constructor(
    @InjectModel(Flow.name) private readonly flowModel: Model<FlowDocument>,
    @InjectModel(FlowHitlMemory.name) private readonly memoryModel: Model<FlowHitlMemoryDocument>,
  ) {}

  async listMemories(flowId: string, ownerId: string): Promise<FlowHitlMemory[]> {
    await this.findOwnedFlow(flowId, ownerId);
    return this.memoryModel.find({ flowId, ownerId }).sort({ updatedAt: -1 }).lean();
  }

  async createMemory(flowId: string, ownerId: string, dto: CreateHitlMemoryDto): Promise<FlowHitlMemory> {
    await this.findOwnedFlow(flowId, ownerId);
    const created = await this.memoryModel.create({
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
    return created.toJSON() as FlowHitlMemory;
  }

  async updateMemory(flowId: string, ownerId: string, memoryId: string, dto: UpdateHitlMemoryDto): Promise<FlowHitlMemory> {
    await this.findOwnedFlow(flowId, ownerId);
    const updated = await this.memoryModel.findOneAndUpdate(
      { _id: memoryId, flowId, ownerId },
      { $set: dto },
      { new: true },
    );
    if (!updated) throw new NotFoundException(ErrorCode.NOT_FOUND, 'HITL memory not found');
    return updated.toJSON() as FlowHitlMemory;
  }

  async deleteMemory(flowId: string, ownerId: string, memoryId: string): Promise<{ deleted: true }> {
    await this.findOwnedFlow(flowId, ownerId);
    const deleted = await this.memoryModel.deleteOne({ _id: memoryId, flowId, ownerId });
    if (!deleted.deletedCount) throw new NotFoundException(ErrorCode.NOT_FOUND, 'HITL memory not found');
    return { deleted: true };
  }

  private async findOwnedFlow(flowId: string, ownerId: string): Promise<FlowDocument> {
    const flow = await this.flowModel.findOne({ _id: flowId, ownerId });
    if (!flow) throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook not found');
    return flow;
  }
}

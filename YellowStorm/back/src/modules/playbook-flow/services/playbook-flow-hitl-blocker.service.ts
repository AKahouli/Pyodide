import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { BadRequestException, NotFoundException } from '@modules/exceptions';
import { CreateHitlBlockerDto, NormalizeHitlBlockerDto, UpdateHitlBlockerDto } from '../dto/playbook-flow-hitl.dto';
import { Flow, FlowDocument } from '../schemas/playbook-flow.schema';
import { HitlBlockerRule } from '../schemas/playbook-flow-hitl.schema';

/** Owns workflow and node HITL blocker catalog persistence and deterministic normalization defaults. */
@Injectable()
export class PlaybookFlowHitlBlockerService {
  constructor(@InjectModel(Flow.name) private readonly flowModel: Model<FlowDocument>) {}

  async listBlockers(flowId: string, ownerId: string): Promise<HitlBlockerRule[]> {
    const flow = await this.findOwnedFlow(flowId, ownerId);
    return (flow.hitlBlockers ?? []) as HitlBlockerRule[];
  }

  async createBlocker(flowId: string, ownerId: string, dto: CreateHitlBlockerDto): Promise<HitlBlockerRule> {
    const flow = await this.findOwnedFlow(flowId, ownerId);
    this.assertScopeConsistency(dto.scope ?? 'workflow', dto.nodeId);
    const blocker = this.buildBlocker(dto);
    flow.hitlBlockers = [...(flow.hitlBlockers ?? []), blocker];
    await flow.save();
    return blocker;
  }

  async updateBlocker(flowId: string, ownerId: string, blockerId: string, dto: UpdateHitlBlockerDto): Promise<HitlBlockerRule> {
    const flow = await this.findOwnedFlow(flowId, ownerId);
    if (dto.scope !== undefined || dto.nodeId !== undefined) {
      this.assertScopeConsistency(dto.scope ?? 'workflow', dto.nodeId);
    }
    const blockers = [...(flow.hitlBlockers ?? [])] as HitlBlockerRule[];
    const index = blockers.findIndex((blocker) => blocker.id === blockerId);
    if (index < 0) throw new NotFoundException(ErrorCode.NOT_FOUND, 'HITL blocker not found');

    const updated = { ...blockers[index], ...dto, id: blockerId, updatedAt: new Date() } as HitlBlockerRule;
    blockers[index] = updated;
    flow.hitlBlockers = blockers;
    await flow.save();
    return updated;
  }

  async deleteBlocker(flowId: string, ownerId: string, blockerId: string): Promise<{ deleted: true }> {
    const flow = await this.findOwnedFlow(flowId, ownerId);
    const blockers = [...(flow.hitlBlockers ?? [])] as HitlBlockerRule[];
    const nextBlockers = blockers.filter((blocker) => blocker.id !== blockerId);
    if (nextBlockers.length === blockers.length) {
      throw new NotFoundException(ErrorCode.NOT_FOUND, 'HITL blocker not found');
    }
    flow.hitlBlockers = nextBlockers;
    await flow.save();
    return { deleted: true };
  }

  normalizeBlocker(dto: NormalizeHitlBlockerDto): CreateHitlBlockerDto {
    const description = dto.description.trim();
    if (!description) throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Blocker description is required');

    const lower = description.toLowerCase();
    const action = lower.includes('approve') || lower.includes('confirm') || lower.includes('before sending') ? 'approve' : 'clarify';
    const kind = lower.includes('send') || lower.includes('share') || lower.includes('publish') ? 'external_send' : 'custom';
    return {
      scope: dto.nodeId ? 'node' : 'workflow',
      nodeId: dto.nodeId ?? null,
      enabled: true,
      kind,
      label: description.length > 80 ? `${description.slice(0, 77)}...` : description,
      description,
      action,
      riskLevel: action === 'approve' ? 'high' : 'medium',
      sensitivity: 'balanced',
      matcherType: 'llm_judge',
      matcherConfig: { naturalLanguageRule: description },
    };
  }

  async disableBlocker(flowId: string, ownerId: string, blockerId: string): Promise<void> {
    await this.updateBlocker(flowId, ownerId, blockerId, { enabled: false });
  }

  private buildBlocker(dto: CreateHitlBlockerDto): HitlBlockerRule {
    const now = new Date();
    return {
      id: new Types.ObjectId().toString(),
      scope: dto.scope ?? 'workflow',
      nodeId: dto.nodeId ?? null,
      enabled: dto.enabled ?? true,
      kind: dto.kind,
      label: dto.label,
      description: dto.description,
      action: dto.action,
      riskLevel: dto.riskLevel ?? 'medium',
      sensitivity: dto.sensitivity ?? 'balanced',
      matcherType: dto.matcherType ?? 'llm_judge',
      matcherConfig: dto.matcherConfig ?? {},
      promptTemplate: dto.promptTemplate ?? null,
      appliesToToolNames: dto.appliesToToolNames ?? [],
      appliesToConnectorActions: dto.appliesToConnectorActions ?? [],
      createdBy: 'user',
      createdAt: now,
      updatedAt: now,
    } as HitlBlockerRule;
  }

  private assertScopeConsistency(scope: 'workflow' | 'node', nodeId?: string | null): void {
    if (scope === 'node' && !nodeId) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Node scope requires a nodeId.');
    }
    if (scope === 'workflow' && nodeId) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Workflow scope cannot include a nodeId.');
    }
  }
  private async findOwnedFlow(flowId: string, ownerId: string): Promise<FlowDocument> {
    const flow = await this.flowModel.findOne({ _id: flowId, ownerId });
    if (!flow) throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook not found');
    return flow;
  }
}

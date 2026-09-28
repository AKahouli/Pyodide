import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { ConflictException, NotFoundException } from '@modules/exceptions';
import { DEFAULT_HITL_POLICY, HitlPolicy } from '../models/playbook-flow-hitl.model';
import { FlowRepository, type FlowRecord } from '../persistence/flow.repository';

/** Resolves workflow and node HITL policy defaults used by APIs, snapshots, and prompt injection. */
@Injectable()
export class PlaybookFlowHitlPromptService {
  constructor(
    private readonly flows: FlowRepository,
    private readonly configService: ConfigService,
  ) {}

  async getPolicy(flowId: string, ownerId: string): Promise<HitlPolicy> {
    const flow = await this.findOwnedFlow(flowId, ownerId);
    const compatiblePolicy = this.applyLegacyCompatibility(
      this.toPolicyRecord(flow.hitlPolicy),
      flow as unknown as Record<string, unknown>,
    );
    return { ...this.buildPolicyDefaults(), ...compatiblePolicy } as HitlPolicy;
  }

  async updatePolicy(flowId: string, ownerId: string, patch: Partial<HitlPolicy>): Promise<HitlPolicy> {
    const flow = await this.findOwnedFlow(flowId, ownerId);
    const compatiblePolicy = this.applyLegacyCompatibility(
      this.toPolicyRecord(flow.hitlPolicy),
      flow as unknown as Record<string, unknown>,
    );
    const nextPolicy = { ...this.buildPolicyDefaults(), ...compatiblePolicy, ...patch };
    const saved = await this.flows.updateFields(flow.id, { hitlPolicy: nextPolicy as HitlPolicy }, { ownerId });
    if (!saved) throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook not found');
    return nextPolicy as HitlPolicy;
  }

  async getNodePolicy(flowId: string, ownerId: string, nodeId: string): Promise<HitlPolicy> {
    const flow = await this.findOwnedFlow(flowId, ownerId);
    const { node } = this.findNode(flow, nodeId);
    return {
      ...this.buildPolicyDefaults(),
      inheritedFromWorkflow: true,
      ...this.applyLegacyCompatibility(
        this.toPolicyRecord(node.hitlPolicy),
        node,
      ),
    } as HitlPolicy;
  }

  async updateNodePolicy(flowId: string, ownerId: string, nodeId: string, patch: Partial<HitlPolicy>): Promise<HitlPolicy> {
    const flow = await this.findOwnedFlow(flowId, ownerId);
    const { node, index } = this.findNode(flow, nodeId);
    const nextPolicy = {
      ...this.buildPolicyDefaults(),
      inheritedFromWorkflow: true,
      ...this.applyLegacyCompatibility(
        this.toPolicyRecord(node.hitlPolicy),
        node,
      ),
      ...patch,
    };
    if (!await this.flows.setNodeHitlPolicy(flow.id, ownerId, index, nodeId, nextPolicy as HitlPolicy)) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Playbook changed while updating the node policy. Refresh and retry.');
    }
    return nextPolicy as HitlPolicy;
  }

  private buildPolicyDefaults(): HitlPolicy {
    if (this.configService.get<boolean>('playbook-flow.smartHitlDefaultEnabled', true)) {
      return { ...DEFAULT_HITL_POLICY } as HitlPolicy;
    }
    return {
      ...DEFAULT_HITL_POLICY,
      mode: 'manual',
      disabledReason: 'Smart HITL defaults are disabled by configuration.',
    } as HitlPolicy;
  }

  private async findOwnedFlow(flowId: string, ownerId: string): Promise<FlowRecord> {
    const flow = await this.flows.findOwned(flowId, ownerId);
    if (!flow) throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook not found');
    return flow;
  }

  private findNode(flow: FlowRecord, nodeId: string): { node: Record<string, unknown>; index: number } {
    const index = (flow.nodes as unknown as Array<Record<string, unknown>>).findIndex((item) => item.id === nodeId);
    const node = index >= 0 ? (flow.nodes as unknown as Array<Record<string, unknown>>)[index] : undefined;
    if (!node) throw new NotFoundException(ErrorCode.NOT_FOUND, 'Playbook node not found');
    return { node, index };
  }

  private applyLegacyCompatibility(policy: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
    const hasLegacyManual = this.hasLegacyManualMode(source);
    if (hasLegacyManual && policy.mode == null) {
      return { ...policy, mode: 'manual', disabledReason: undefined };
    }
    return policy;
  }

  private toPolicyRecord(policy: unknown): Record<string, unknown> {
    if (!policy || typeof policy !== 'object') {
      return {};
    }
    return { ...(policy as Record<string, unknown>) };
  }

  private hasLegacyManualMode(source: Record<string, unknown>): boolean {
    if (!source) {
      return false;
    }
    return (
      source.allowClarification === true
      || source.interruptBefore === true
      || source.interruptAfter === true
    );
  }
}

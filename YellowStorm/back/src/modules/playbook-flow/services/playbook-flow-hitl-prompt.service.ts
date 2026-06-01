import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { NotFoundException } from '@modules/exceptions';
import { Flow, FlowDocument } from '../schemas/playbook-flow.schema';
import { DEFAULT_HITL_POLICY, HitlPolicy } from '../schemas/playbook-flow-hitl.schema';

/** Resolves workflow and node HITL policy defaults used by APIs, snapshots, and prompt injection. */
@Injectable()
export class PlaybookFlowHitlPromptService {
  constructor(
    @InjectModel(Flow.name) private readonly flowModel: Model<FlowDocument>,
    private readonly configService: ConfigService,
  ) {}

  async getPolicy(flowId: string, ownerId: string): Promise<HitlPolicy> {
    const flow = await this.findOwnedFlow(flowId, ownerId);
    const compatiblePolicy = this.applyLegacyCompatibility(
      (flow.hitlPolicy as unknown as Record<string, unknown>) ?? {},
      flow as unknown as Record<string, unknown>,
    );
    return { ...this.buildPolicyDefaults(), ...compatiblePolicy } as HitlPolicy;
  }

  async updatePolicy(flowId: string, ownerId: string, patch: Partial<HitlPolicy>): Promise<HitlPolicy> {
    const flow = await this.findOwnedFlow(flowId, ownerId);
    const compatiblePolicy = this.applyLegacyCompatibility(
      (flow.hitlPolicy as unknown as Record<string, unknown>) ?? {},
      flow as unknown as Record<string, unknown>,
    );
    const nextPolicy = { ...this.buildPolicyDefaults(), ...compatiblePolicy, ...patch };
    flow.hitlPolicy = nextPolicy as HitlPolicy;
    await flow.save();
    return nextPolicy as HitlPolicy;
  }

  async getNodePolicy(flowId: string, ownerId: string, nodeId: string): Promise<HitlPolicy> {
    const flow = await this.findOwnedFlow(flowId, ownerId);
    const node = this.findNode(flow, nodeId);
    return {
      ...this.buildPolicyDefaults(),
      inheritedFromWorkflow: true,
      ...this.applyLegacyCompatibility(
        (node.hitlPolicy as Record<string, unknown> | undefined) ?? {},
        node,
      ),
    } as HitlPolicy;
  }

  async updateNodePolicy(flowId: string, ownerId: string, nodeId: string, patch: Partial<HitlPolicy>): Promise<HitlPolicy> {
    const flow = await this.findOwnedFlow(flowId, ownerId);
    const node = this.findNode(flow, nodeId);
    const nextPolicy = {
      ...this.buildPolicyDefaults(),
      inheritedFromWorkflow: true,
      ...this.applyLegacyCompatibility(
        (node.hitlPolicy as Record<string, unknown> | undefined) ?? {},
        node,
      ),
      ...patch,
    };
    node.hitlPolicy = nextPolicy as HitlPolicy;
    await flow.save();
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

  private async findOwnedFlow(flowId: string, ownerId: string): Promise<FlowDocument> {
    const flow = await this.flowModel.findOne({ _id: flowId, ownerId });
    if (!flow) throw new NotFoundException(ErrorCode.PLAYBOOK_FLOW_NOT_FOUND, 'Playbook not found');
    return flow;
  }

  private findNode(flow: FlowDocument, nodeId: string): Record<string, unknown> {
    const node = (flow.nodes as unknown as Array<Record<string, unknown>>).find((item) => item.id === nodeId);
    if (!node) throw new NotFoundException(ErrorCode.NOT_FOUND, 'Playbook node not found');
    return node;
  }

  private applyLegacyCompatibility(policy: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
    const hasLegacyManual = this.hasLegacyManualMode(source);
    if (hasLegacyManual && policy.mode == null) {
      return { ...policy, mode: 'manual', disabledReason: undefined };
    }
    return policy;
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

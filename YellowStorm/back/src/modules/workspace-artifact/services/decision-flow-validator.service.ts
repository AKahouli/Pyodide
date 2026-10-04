import { Injectable } from '@nestjs/common';
import { BadRequestException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { DECISION_FLOW_LIMITS } from '../constants/decision-flow.constants';
import type { DecisionFlowEdge, DecisionFlowNode, DecisionFlowPayload } from '../interfaces/decision-flow.interface';

@Injectable()
export class DecisionFlowValidatorService {
  validate(value: unknown): DecisionFlowPayload {
    if (!value || typeof value !== 'object') this.fail('The decision-flow payload must be an object');
    const payload = value as Partial<DecisionFlowPayload>;
    if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) this.fail('The decision-flow payload requires nodes and edges arrays');
    if (payload.nodes.length > DECISION_FLOW_LIMITS.nodes || payload.edges.length > DECISION_FLOW_LIMITS.edges) this.fail('The decision flow is too large');
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > DECISION_FLOW_LIMITS.serializedBytes) this.fail('The decision-flow payload is too large');
    const nodeIds = new Set<string>();
    let starts = 0;
    for (const node of payload.nodes) {
      if (!node || typeof node.id !== 'string' || !node.id || nodeIds.has(node.id)) this.fail('Decision-flow node identifiers must be unique');
      if (!['start', 'information', 'decision', 'result', 'end'].includes(node.type) || typeof node.label !== 'string' || node.label.length > DECISION_FLOW_LIMITS.label) this.fail('A decision-flow node is invalid');
      if (node.description !== undefined && (typeof node.description !== 'string' || node.description.length > DECISION_FLOW_LIMITS.description)) this.fail('A decision-flow node description is invalid');
      if (node.position && (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y))) this.fail('A decision-flow node position is invalid');
      if (node.sourceRefs !== undefined && (!Array.isArray(node.sourceRefs) || node.sourceRefs.length > 10 || node.sourceRefs.some((reference) => !Number.isInteger(reference.page) || reference.page < 1 || typeof reference.passage !== 'string' || !reference.passage.trim() || reference.passage.length > DECISION_FLOW_LIMITS.description))) this.fail('A decision-flow node source reference is invalid');
      if (node.needsConfirmation !== undefined && typeof node.needsConfirmation !== 'boolean') this.fail('A decision-flow node confirmation flag is invalid');
      if (node.uncertaintyReason !== undefined && (typeof node.uncertaintyReason !== 'string' || node.uncertaintyReason.length > DECISION_FLOW_LIMITS.description)) this.fail('A decision-flow node uncertainty reason is invalid');
      nodeIds.add(node.id); if (node.type === 'start') starts += 1;
    }
    if (starts !== 1) this.fail('A decision flow must have exactly one start node');
    const edgeIds = new Set<string>();
    for (const edge of payload.edges) {
      if (!edge || typeof edge.id !== 'string' || !edge.id || edgeIds.has(edge.id) || !nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target || (edge.label !== undefined && (typeof edge.label !== 'string' || edge.label.length > DECISION_FLOW_LIMITS.label))) this.fail('A decision-flow edge is invalid');
      edgeIds.add(edge.id);
    }
    return { title: typeof payload.title === 'string' && payload.title.length ? payload.title.slice(0, DECISION_FLOW_LIMITS.label) : 'Decision flow', description: payload.description, nodes: payload.nodes, edges: payload.edges, warnings: payload.warnings };
  }
  private fail(message: string): never { throw new BadRequestException(ErrorCode.WORKSPACE_ARTIFACT_INVALID_OUTPUT, message); }
}

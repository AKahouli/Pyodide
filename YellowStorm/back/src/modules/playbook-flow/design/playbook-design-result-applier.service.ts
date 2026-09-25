import { Injectable } from '@nestjs/common';
import { mapGrpcResponseToFlow } from '../services/playbook-flow-design-mapper';
import { ControlEdge, DataBinding, FlowNode } from '../models/playbook-flow.model';

/**
 * Translates design responses into persisted graph updates while preserving bindings when the model omits them.
 */
@Injectable()
export class PlaybookDesignResultApplierService {
  applyToSnapshot(
    response: unknown,
    snapshotBefore: { dataBindings: DataBinding[] },
  ): { nodes: FlowNode[]; controlEdges: ControlEdge[]; dataBindings: DataBinding[] } {
    const { nodes, controlEdges, dataBindings } = mapGrpcResponseToFlow(response as Parameters<typeof mapGrpcResponseToFlow>[0]);
    const generatedTargets = new Set(
      dataBindings.map((binding) => JSON.stringify([binding.targetNode, binding.targetPort])),
    );
    const preservedBindings = snapshotBefore.dataBindings.filter(
      (binding) => !generatedTargets.has(JSON.stringify([binding.targetNode, binding.targetPort])),
    );
    return {
      nodes: nodes as FlowNode[],
      controlEdges: controlEdges as ControlEdge[],
      dataBindings: [...preservedBindings, ...dataBindings] as DataBinding[],
    };
  }
}

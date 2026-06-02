import { Injectable } from '@nestjs/common';
import { mapGrpcResponseToFlow } from '../services/playbook-flow-design-mapper';
import { ControlEdge, DataBinding, FlowNode } from '../schemas/playbook-flow.schema';

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
    return {
      nodes: nodes as FlowNode[],
      controlEdges: controlEdges as ControlEdge[],
      dataBindings: dataBindings.length > 0 ? dataBindings : snapshotBefore.dataBindings,
    };
  }
}

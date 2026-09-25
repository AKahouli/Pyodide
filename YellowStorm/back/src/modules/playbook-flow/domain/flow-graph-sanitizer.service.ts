import { Injectable, Logger } from '@nestjs/common';
import { ControlEdge, DataBinding, FlowNode } from '../models/playbook-flow.model';

export interface SanitizedFlowGraph {
  controlEdges: ControlEdge[];
  dataBindings: DataBinding[];
  removedOrphanedEdgeCount: number;
  removedOrphanedBindingCount: number;
  removedStaleBindingCount: number;
}

/**
 * Normalizes control edges and data bindings so downstream validation only sees graph references that still exist.
 */
@Injectable()
export class FlowGraphSanitizerService {
  private readonly logger = new Logger(FlowGraphSanitizerService.name);

  sanitize(params: {
    nodes: FlowNode[];
    controlEdges: ControlEdge[];
    dataBindings: DataBinding[];
    edgeAction?: 'Removing' | 'Cleaning';
    bindingAction?: 'Removing' | 'Cleaning';
  }): SanitizedFlowGraph {
    const {
      nodes,
      controlEdges,
      dataBindings,
      edgeAction = 'Removing',
      bindingAction = 'Removing',
    } = params;
    const nodeIds = new Set(nodes.map((node) => node.id));

    const controlEdgesBefore = controlEdges.length;
    const cleanedEdges = controlEdges.filter((edge) => {
      const valid = nodeIds.has(edge.source) && nodeIds.has(edge.target);
      if (!valid) {
        this.logger.warn(`${edgeAction} orphaned edge ${edge.id}: source=${edge.source} target=${edge.target}`);
      }
      return valid;
    });

    const cleanedBindings = dataBindings.filter((binding) => {
      const valid = nodeIds.has(binding.targetNode)
        && (binding.sourceNode ? nodeIds.has(binding.sourceNode) : true);
      if (!valid) {
        this.logger.warn(
          `${bindingAction} orphaned data binding ${binding.id}: targetNode=${binding.targetNode} sourceNode=${binding.sourceNode}`,
        );
      }
      return valid;
    });

    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    let removedStaleBindingCount = 0;
    const portCleanedBindings = cleanedBindings.filter((binding) => {
      const targetNode = nodesById.get(binding.targetNode);
      if (!targetNode) {
        return true;
      }

      const targetPortExists = targetNode.input?.ports?.some((port) => port.id === binding.targetPort);
      if (!targetPortExists) {
        removedStaleBindingCount += 1;
        this.logger.warn(
          `${bindingAction} stale data binding ${binding.id}: target port ${binding.targetNode}.${binding.targetPort} no longer exists`,
        );
        return false;
      }

      if (binding.sourceKind !== 'node-output' || !binding.sourceNode) {
        return true;
      }

      const sourceNode = nodesById.get(binding.sourceNode);
      if (!sourceNode) {
        return true;
      }

      const sourcePortExists = sourceNode.output?.ports?.some((port) => port.id === binding.sourcePort);
      if (!sourcePortExists) {
        removedStaleBindingCount += 1;
        this.logger.warn(
          `${bindingAction} stale data binding ${binding.id}: source port ${binding.sourceNode}.${binding.sourcePort} no longer exists`,
        );
        return false;
      }

      return true;
    });

    return {
      controlEdges: cleanedEdges,
      dataBindings: portCleanedBindings,
      removedOrphanedEdgeCount: controlEdgesBefore - cleanedEdges.length,
      removedOrphanedBindingCount: dataBindings.length - cleanedBindings.length,
      removedStaleBindingCount,
    };
  }
}

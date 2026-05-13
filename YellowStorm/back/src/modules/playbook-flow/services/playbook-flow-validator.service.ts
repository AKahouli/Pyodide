import { Injectable } from '@nestjs/common';
import { ControlEdge, DataBinding, FlowNode } from '../schemas/playbook-flow.schema';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { BadRequestException } from '../../exceptions/exceptions/http.exceptions';

interface ValidationError {
  rule: number;
  message: string;
}

@Injectable()
export class PlaybookFlowValidatorService {
  validate(nodes: FlowNode[], controlEdges: ControlEdge[], dataBindings: DataBinding[]): void {
    const errors: ValidationError[] = [];

    errors.push(...this.checkUniqueNodeIds(nodes));
    errors.push(...this.checkEdgeEndpoints(controlEdges, nodes));
    errors.push(...this.checkConditionalEdgeSources(controlEdges, nodes));
    errors.push(...this.checkRouterLabelCoverage(nodes, controlEdges));
    errors.push(...this.checkRouterTerminalRoute(nodes, controlEdges));
    errors.push(...this.checkCycleRouterPresence(nodes, controlEdges));
    errors.push(...this.checkIteratorContainerDag(nodes, controlEdges));
    errors.push(...this.checkRequiredDataBindings(nodes, dataBindings));
    errors.push(...this.checkBindingSourceReachable(nodes, controlEdges, dataBindings));
    errors.push(...this.checkPreviousIterationOnCycle(nodes, controlEdges, dataBindings));
    errors.push(...this.checkBindingTypeMatch(nodes, dataBindings));
    errors.push(...this.checkErrorRoutingCoverage(nodes, controlEdges));

    if (errors.length > 0) {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_VALIDATION_FAILED,
        errors.map((e) => e.message).join('; '),
      );
    }
  }

  private checkUniqueNodeIds(nodes: FlowNode[]): ValidationError[] {
    const ids = new Set<string>();
    const errors: ValidationError[] = [];
    for (const node of nodes) {
      if (ids.has(node.id)) {
        errors.push({ rule: 1, message: `Duplicate node id: ${node.id}` });
      }
      ids.add(node.id);
    }
    return errors;
  }

  private checkEdgeEndpoints(edges: ControlEdge[], nodes: FlowNode[]): ValidationError[] {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const errors: ValidationError[] = [];
    for (const edge of edges) {
      if (!nodeIds.has(edge.source)) {
        errors.push({ rule: 2, message: `Edge ${edge.id} source ${edge.source} does not exist` });
      }
      if (!nodeIds.has(edge.target)) {
        errors.push({ rule: 2, message: `Edge ${edge.id} target ${edge.target} does not exist` });
      }
    }
    return errors;
  }

  private checkConditionalEdgeSources(edges: ControlEdge[], nodes: FlowNode[]): ValidationError[] {
    const routers = new Set(nodes.filter((n) => n.kind === 'router').map((n) => n.id));
    const errors: ValidationError[] = [];
    for (const edge of edges) {
      if (edge.kind === 'conditional' && !routers.has(edge.source)) {
        errors.push({ rule: 3, message: `Conditional edge ${edge.id} source ${edge.source} is not a router` });
      }
    }
    return errors;
  }

  private checkRouterLabelCoverage(nodes: FlowNode[], edges: ControlEdge[]): ValidationError[] {
    const errors: ValidationError[] = [];
    for (const node of nodes) {
      if (node.kind !== 'router' || !node.routerConfig) continue;
      const declaredLabels = new Set(node.routerConfig.outputLabels);
      const outgoingLabels = new Set(
        edges
          .filter((e) => e.source === node.id && e.kind === 'conditional')
          .map((e) => e.routerLabel)
          .filter(Boolean),
      );
      for (const label of declaredLabels) {
        if (!outgoingLabels.has(label)) {
          errors.push({ rule: 4, message: `Router ${node.id} label "${label}" has no outgoing edge` });
        }
      }
    }
    return errors;
  }

  private checkRouterTerminalRoute(_nodes: FlowNode[], _edges: ControlEdge[]): ValidationError[] {
    return [];
  }

  private checkCycleRouterPresence(_nodes: FlowNode[], _edges: ControlEdge[]): ValidationError[] {
    return [];
  }

  private checkIteratorContainerDag(_nodes: FlowNode[], _edges: ControlEdge[]): ValidationError[] {
    return [];
  }

  private checkRequiredDataBindings(nodes: FlowNode[], bindings: DataBinding[]): ValidationError[] {
    const errors: ValidationError[] = [];
    for (const node of nodes) {
      if (!node.input?.ports) continue;
      for (const port of node.input.ports) {
        if (!port.required) continue;
        const binding = bindings.filter((b) => b.targetNode === node.id && b.targetPort === port.id);
        if (binding.length === 0) {
          errors.push({ rule: 8, message: `Required port ${node.id}.${port.id} has no data binding` });
        } else if (binding.length > 1) {
          errors.push({ rule: 8, message: `Port ${node.id}.${port.id} has multiple data bindings` });
        }
      }
    }
    return errors;
  }

  private checkBindingSourceReachable(
    nodes: FlowNode[],
    edges: ControlEdge[],
    bindings: DataBinding[],
  ): ValidationError[] {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edgesBySource = new Map<string, string[]>();
    for (const e of edges) {
      const targets = edgesBySource.get(e.source) || [];
      targets.push(e.target);
      edgesBySource.set(e.source, targets);
    }

    const findRoots = (): string[] => {
      const targets = new Set(edges.map((e) => e.target));
      return [...nodeIds].filter((id) => !targets.has(id));
    };

    const roots = findRoots();
    const reachable = new Set<string>();
    const visited = new Set<string>();

    const dfs = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      reachable.add(nodeId);
      const targets = edgesBySource.get(nodeId) || [];
      for (const t of targets) dfs(t);
    };

    for (const root of roots.concat([...nodeIds])) {
      dfs(root);
    }

    const errors: ValidationError[] = [];
    for (const binding of bindings) {
      if (binding.sourceKind === 'node-output' && binding.sourceNode) {
        if (!reachable.has(binding.sourceNode)) {
          errors.push({ rule: 9, message: `Data binding source ${binding.sourceNode} is not reachable` });
        }
      }
    }
    return errors;
  }

  private checkPreviousIterationOnCycle(
    _nodes: FlowNode[],
    _edges: ControlEdge[],
    bindings: DataBinding[],
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    for (const binding of bindings) {
      if (binding.iteration === 'previous' && binding.sourceNode) {
        const inCycle = this.isNodeInCycle(binding.sourceNode, _edges);
        if (!inCycle) {
          errors.push({ rule: 10, message: `Previous-iteration binding to ${binding.sourceNode} outside a cycle` });
        }
      }
    }
    return errors;
  }

  private isNodeInCycle(nodeId: string, edges: ControlEdge[]): boolean {
    const adjacency = new Map<string, string[]>();
    for (const e of edges) {
      const list = adjacency.get(e.source) || [];
      list.push(e.target);
      adjacency.set(e.source, list);
    }
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const dfs = (current: string): boolean => {
      visited.add(current);
      recStack.add(current);
      for (const next of adjacency.get(current) || []) {
        if (!visited.has(next)) {
          if (dfs(next)) return true;
        } else if (recStack.has(next)) {
          return true;
        }
      }
      recStack.delete(current);
      return false;
    };

    return dfs(nodeId);
  }

  private checkBindingTypeMatch(nodes: FlowNode[], bindings: DataBinding[]): ValidationError[] {
    return [];
  }

  private checkErrorRoutingCoverage(
    nodes: FlowNode[],
    edges: ControlEdge[],
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const routers = new Map<string, FlowNode>();
    for (const node of nodes) {
      if (node.kind === 'router') routers.set(node.id, node);
    }

    const nodeTargets = new Map<string, string[]>();
    for (const e of edges) {
      const targets = nodeTargets.get(e.source) || [];
      targets.push(e.target);
      nodeTargets.set(e.source, targets);
    }

    const findDownstreamRouter = (nodeId: string, seen: Set<string>): string | null => {
      if (seen.has(nodeId)) return null;
      seen.add(nodeId);
      if (routers.has(nodeId)) return nodeId;
      for (const next of nodeTargets.get(nodeId) || []) {
        const found = findDownstreamRouter(next, seen);
        if (found) return found;
      }
      return null;
    };

    for (const node of nodes) {
      if (node.kind === 'step' && node.retryPolicy) {
        const downstreamRouter = findDownstreamRouter(node.id, new Set());
        if (downstreamRouter) {
          const router = routers.get(downstreamRouter);
          if (router && !router.routerConfig?.outputLabels.includes('__error__')) {
            errors.push({
              rule: 12,
              message: `Node ${node.id} can fail but downstream router ${downstreamRouter} does not handle __error__`,
            });
          }
        }
      }
    }
    return errors;
  }
}

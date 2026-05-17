import { Injectable } from '@nestjs/common';
import { ControlEdge, DataBinding, FlowNode } from '../schemas/playbook-flow.schema';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { BadRequestException } from '../../exceptions/exceptions/http.exceptions';
import { RESERVED_LABELS } from '../constants/reserved-labels';
import {
  buildAdjacency,
  canReachTarget,
  findCycleComponents,
  hasCycleWithinNodes,
  isNodeInCycle,
} from '../utils/playbook-flow-validation-graph.util';

interface ValidationError {
  rule: number;
  message: string;
}

interface ValidateOptions {
  allowDraftRouters?: boolean;
}

@Injectable()
export class PlaybookFlowValidatorService {
  validate(nodes: FlowNode[], controlEdges: ControlEdge[], dataBindings: DataBinding[], options: ValidateOptions = {}): void {
    const errors: ValidationError[] = [];

    errors.push(...this.checkUniqueNodeIds(nodes));
    errors.push(...this.checkEdgeEndpoints(controlEdges, nodes));
    errors.push(...this.checkConditionalEdgeSources(controlEdges, nodes));
    errors.push(...this.checkRouterLabelCoverage(nodes, controlEdges, options));
    errors.push(...this.checkRouterConditionConfiguration(nodes, controlEdges));
    errors.push(...this.checkRouterTerminalRoute(nodes, controlEdges));
    errors.push(...this.checkCycleRouterPresence(nodes, controlEdges));
    errors.push(...this.checkIteratorContainerDag(nodes, controlEdges));
    errors.push(...this.checkBindingEndpoints(nodes, dataBindings));
    errors.push(...this.checkRequiredDataBindings(nodes, dataBindings));
    errors.push(...this.checkDuplicateDataBindings(dataBindings));
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

  private checkRouterLabelCoverage(
    nodes: FlowNode[],
    edges: ControlEdge[],
    options: ValidateOptions,
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    for (const node of nodes) {
      if (node.kind !== 'router' || !node.routerConfig) continue;
      const outgoingLabels = new Set(
        edges
          .filter((e) => e.source === node.id && e.kind === 'conditional')
          .map((e) => e.routerLabel)
          .filter(Boolean),
      );
      if (options.allowDraftRouters && outgoingLabels.size === 0) {
        continue;
      }

      const declaredLabels = new Set(node.routerConfig.outputLabels.filter((label) => !RESERVED_LABELS.includes(label as any)));

      for (const label of declaredLabels) {
        if (!outgoingLabels.has(label)) {
          errors.push({ rule: 4, message: `Router ${node.id} label "${label}" has no outgoing edge` });
        }
      }
    }
    return errors;
  }

  private checkRouterTerminalRoute(_nodes: FlowNode[], _edges: ControlEdge[]): ValidationError[] {
    const adjacency = buildAdjacency(_edges);
    const cycleRouters = new Set(
      findCycleComponents(_nodes.map((node) => node.id), _edges)
        .flatMap((component) => component)
        .filter((nodeId) => _nodes.find((node) => node.id === nodeId)?.kind === 'router'),
    );

    const errors: ValidationError[] = [];
    for (const node of _nodes) {
      if (node.kind !== 'router' || !cycleRouters.has(node.id)) {
        continue;
      }

      const hasTerminalExit = _edges
        .filter((edge) => edge.source === node.id && edge.kind === 'conditional')
        .some((edge) => !canReachTarget(adjacency, edge.target, node.id));

      if (!hasTerminalExit) {
        errors.push({
          rule: 5,
          message: `Router ${node.id} cycle has no terminal exit route`,
        });
      }
    }

    return errors;
  }

  private checkCycleRouterPresence(_nodes: FlowNode[], _edges: ControlEdge[]): ValidationError[] {
    const nodesById = new Map(_nodes.map((node) => [node.id, node]));
    const errors: ValidationError[] = [];

    for (const component of findCycleComponents(_nodes.map((node) => node.id), _edges)) {
      const routers = component
        .map((nodeId) => nodesById.get(nodeId))
        .filter((node): node is FlowNode => Boolean(node && node.kind === 'router'));

      if (routers.length === 0) {
        errors.push({
          rule: 6,
          message: `Cycle ${component.sort().join(' -> ')} must include a router`,
        });
        continue;
      }

      const hasBoundedRouter = routers.some((router) => (router.routerConfig?.maxIterations ?? 0) > 0);
      if (!hasBoundedRouter) {
        errors.push({
          rule: 6,
          message: `Cycle ${component.sort().join(' -> ')} must include a router with maxIterations > 0`,
        });
      }
    }

    return errors;
  }

  private checkIteratorContainerDag(nodes: FlowNode[], edges: ControlEdge[]): ValidationError[] {
    const errors: ValidationError[] = [];

    for (const node of nodes) {
      if (node.kind !== 'iterator') {
        continue;
      }

      const childNodeIds = new Set(
        nodes
          .filter((candidate) => {
            const containerConfig = (candidate.metadata?.containerConfig as { parentIteratorId?: string | null } | undefined);
            return containerConfig?.parentIteratorId === node.id;
          })
          .map((candidate) => candidate.id),
      );

      if (childNodeIds.size === 0) {
        continue;
      }

      if (hasCycleWithinNodes(childNodeIds, edges)) {
        errors.push({
          rule: 7,
          message: `Iterator ${node.id} body must be acyclic`,
        });
      }
    }

    return errors;
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

  private checkRouterConditionConfiguration(nodes: FlowNode[], edges: ControlEdge[]): ValidationError[] {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const adjacency = buildAdjacency(edges);

    const errors: ValidationError[] = [];

    for (const node of nodes) {
      if (node.kind !== 'router' || !node.routerConfig) continue;

      const labelSet = new Set(node.routerConfig.outputLabels);
      const conditions = node.routerConfig.conditions ?? [];

      if (node.routerConfig.defaultLabel && !labelSet.has(node.routerConfig.defaultLabel)) {
        errors.push({
          rule: 5,
          message: `Router ${node.id} default label "${node.routerConfig.defaultLabel}" is not declared in outputLabels`,
        });
      }

      if (conditions.length > 0 && !node.routerConfig.defaultLabel) {
        errors.push({
          rule: 5,
          message: `Router ${node.id} requires defaultLabel when deterministic conditions are configured`,
        });
      }

      conditions.forEach((condition, index) => {
        if (!labelSet.has(condition.label)) {
          errors.push({
            rule: 5,
            message: `Router ${node.id} condition ${index} label "${condition.label}" is not declared in outputLabels`,
          });
        }

        if (!condition.sourceNode || !condition.sourcePort) {
          errors.push({
            rule: 5,
            message: `Router ${node.id} condition ${index} requires sourceNode and sourcePort`,
          });
          return;
        }

        const sourceNode = nodesById.get(condition.sourceNode);
        if (!sourceNode) {
          errors.push({
            rule: 5,
            message: `Router ${node.id} condition ${index} source node ${condition.sourceNode} does not exist`,
          });
          return;
        }

        const sourcePort = sourceNode.output?.ports?.find((port) => port.id === condition.sourcePort);
        if (!sourcePort) {
          errors.push({
            rule: 5,
            message: `Router ${node.id} condition ${index} source port ${condition.sourceNode}.${condition.sourcePort} does not exist`,
          });
          return;
        }

        if (!canReachTarget(adjacency, condition.sourceNode, node.id)) {
          errors.push({
            rule: 5,
            message: `Router ${node.id} condition ${index} source ${condition.sourceNode} cannot reach router`,
          });
        }
      });
    }

    return errors;
  }

  private checkBindingEndpoints(nodes: FlowNode[], bindings: DataBinding[]): ValidationError[] {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const errors: ValidationError[] = [];

    for (const binding of bindings) {
      const targetNode = nodesById.get(binding.targetNode);
      if (!targetNode) {
        errors.push({ rule: 7, message: `Data binding ${binding.id} target node ${binding.targetNode} does not exist` });
        continue;
      }

      const targetPort = targetNode.input?.ports?.find((port) => port.id === binding.targetPort);
      if (!targetPort) {
        errors.push({ rule: 7, message: `Data binding ${binding.id} target port ${binding.targetNode}.${binding.targetPort} does not exist` });
      }

      if (binding.sourceKind !== 'node-output') {
        continue;
      }

      if (!binding.sourceNode || !binding.sourcePort) {
        errors.push({ rule: 7, message: `Data binding ${binding.id} source node-output bindings require sourceNode and sourcePort` });
        continue;
      }

      const sourceNode = nodesById.get(binding.sourceNode);
      if (!sourceNode) {
        errors.push({ rule: 7, message: `Data binding ${binding.id} source node ${binding.sourceNode} does not exist` });
        continue;
      }

      const sourcePort = sourceNode.output?.ports?.find((port) => port.id === binding.sourcePort);
      if (!sourcePort) {
        errors.push({ rule: 7, message: `Data binding ${binding.id} source port ${binding.sourceNode}.${binding.sourcePort} does not exist` });
      }
    }

    return errors;
  }

  private checkDuplicateDataBindings(bindings: DataBinding[]): ValidationError[] {
    const errors: ValidationError[] = [];
    const seenTargets = new Set<string>();

    for (const binding of bindings) {
      const key = `${binding.targetNode}:${binding.targetPort}`;
      if (seenTargets.has(key)) {
        errors.push({ rule: 11, message: `Target port ${binding.targetNode}.${binding.targetPort} has multiple data bindings` });
        continue;
      }
      seenTargets.add(key);
    }

    return errors;
  }

  private checkBindingSourceReachable(
    _nodes: FlowNode[],
    edges: ControlEdge[],
    bindings: DataBinding[],
  ): ValidationError[] {
    const adjacency = buildAdjacency(edges);

    const errors: ValidationError[] = [];
    for (const binding of bindings) {
      if (binding.sourceKind === 'node-output' && binding.sourceNode) {
        if (!canReachTarget(adjacency, binding.sourceNode, binding.targetNode)) {
          errors.push({
            rule: 9,
            message: `Data binding ${binding.id} source ${binding.sourceNode} cannot reach target ${binding.targetNode}`,
          });
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
        const inCycle = isNodeInCycle(binding.sourceNode, _edges);
        if (!inCycle) {
          errors.push({ rule: 10, message: `Previous-iteration binding to ${binding.sourceNode} outside a cycle` });
        }
      }
    }
    return errors;
  }

  private checkBindingTypeMatch(nodes: FlowNode[], bindings: DataBinding[]): ValidationError[] {
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const errors: ValidationError[] = [];

    for (const binding of bindings) {
      if (binding.sourceKind !== 'node-output' || !binding.sourceNode || !binding.sourcePort) {
        continue;
      }

      const sourcePort = nodesById
        .get(binding.sourceNode)
        ?.output
        ?.ports
        ?.find((port) => port.id === binding.sourcePort);
      const targetPort = nodesById
        .get(binding.targetNode)
        ?.input
        ?.ports
        ?.find((port) => port.id === binding.targetPort);

      if (!sourcePort || !targetPort || !sourcePort.type || !targetPort.type) {
        continue;
      }

      if (sourcePort.type !== targetPort.type) {
        errors.push({
          rule: 13,
          message: `Data binding ${binding.id} type mismatch: ${binding.sourceNode}.${binding.sourcePort} (${sourcePort.type}) -> ${binding.targetNode}.${binding.targetPort} (${targetPort.type})`,
        });
      }
    }

    return errors;
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

import { Injectable, Logger } from '@nestjs/common';
import { ExecutionRepository } from '../../persistence/execution.repository';
import { TaskResultRepository } from '../../persistence/task-result.repository';
import { FlowSnapshot } from '../../mappers/flow-to-snapshot.mapper';
import type { ControlEdge, DataBinding, FlowNode } from '../../models/playbook-flow.model';
import { ErrorCode } from '../../../exceptions/constants/error-codes';
import { BadRequestException } from '../../../exceptions/exceptions/http.exceptions';
import {
  FlowCompletedResultPayload,
  FlowLlmPromptTraceItem,
  FlowSemanticMatchSummary,
  FlowToolTraceItem,
  FlowUsageSummary,
} from '../../interfaces/playbook-flow-observability.interface';
import { PublicReasoningTraceItem } from '../../interfaces/playbook-flow-reasoning.interface';

const SINGLE_STEP_UNSUPPORTED_MESSAGE =
  'Single-step execution only supports step nodes outside iterators. Dependent nodes require completed upstream results.';

export interface SeededTaskOutput {
  nodeId: string;
  iteration: number;
  payload: FlowCompletedResultPayload;
}

function isNodeEnabled(node: Pick<FlowNode, 'metadata'>): boolean {
  return node.metadata?.enabled !== false;
}

function comparableNode(node: Record<string, unknown>): Record<string, unknown> {
  const metadata = node.metadata as Record<string, unknown> | undefined;
  if (!metadata) return node;
  const { positionX, positionY, ...executionMetadata } = metadata;
  return { ...node, metadata: executionMetadata };
}

/**
 * Single-step validation, executable snapshot filtering, and upstream seed prep.
 *
 * Keeps start/runFromStep orchestration on PlaybookFlowExecutionService while
 * owning the self-contained single-step rules and seeding logic.
 */
@Injectable()
export class PlaybookExecutionSingleStepPrepService {
  private readonly logger = new Logger(PlaybookExecutionSingleStepPrepService.name);

  constructor(
    private readonly executionRepository: ExecutionRepository,
    private readonly taskResultRepository: TaskResultRepository,
  ) {}

  assertSingleStepSupported(nodes: FlowNode[], singleStepTaskId: string): void {
    const targetNode = nodes.find((node) => node.id === singleStepTaskId);
    if (!targetNode) {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_VALIDATION_FAILED,
        `Single-step target node ${singleStepTaskId} not found`,
      );
    }

    if (!isNodeEnabled(targetNode)) {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_VALIDATION_FAILED,
        `Single-step target node ${singleStepTaskId} is disabled`,
      );
    }

    const kind = targetNode.kind;
    const containerConfig = (targetNode.metadata as {
      containerConfig?: { parentIteratorId?: string | null };
    } | undefined)?.containerConfig;

    if (kind !== 'step' || containerConfig?.parentIteratorId) {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_VALIDATION_FAILED,
        SINGLE_STEP_UNSUPPORTED_MESSAGE,
      );
    }
  }

  assertSingleStepControlDependenciesSupported(
    nodes: FlowNode[],
    controlEdges: ControlEdge[],
    singleStepTaskId: string,
  ): void {
    const incomingEdges = controlEdges.filter((edge) => edge.target === singleStepTaskId);
    const unsupportedEdge = incomingEdges.find((edge) => {
      if (edge.kind !== 'sequential') {
        return true;
      }

      const sourceNode = nodes.find((node) => node.id === edge.source);
      return !sourceNode || sourceNode.kind !== 'step';
    });

    if (unsupportedEdge) {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_VALIDATION_FAILED,
        'Single-step execution only supports nodes reached by sequential step dependencies.',
      );
    }
  }

  buildExecutableSnapshot(snapshot: FlowSnapshot, flowId: string): FlowSnapshot {
    const nodes = snapshot.nodes ?? [];
    const controlEdges = snapshot.controlEdges ?? [];
    const dataBindings = snapshot.dataBindings ?? [];

    const enabledNodes = nodes.filter((node) => {
      const enabled = isNodeEnabled(node);
      if (!enabled) {
        this.logger.warn(`Dropping disabled node ${node.id} from execution snapshot for flow ${flowId}`);
      }
      return enabled;
    });

    if (enabledNodes.length === nodes.length) {
      return snapshot;
    }

    const enabledNodeIds = new Set(enabledNodes.map((node) => node.id));
    const reachableNodeIds = this.reachableFromOriginalEntrypoints(nodes, controlEdges, enabledNodeIds);
    const executableNodes = enabledNodes.filter((node) => reachableNodeIds.has(node.id));
    const executableControlEdges = controlEdges.filter((edge) => {
      const keep = reachableNodeIds.has(edge.source) && reachableNodeIds.has(edge.target);
      if (!keep) {
        this.logger.warn(
          `Dropping control edge ${edge.id} from execution snapshot because its branch is disabled`,
        );
      }
      return keep;
    });
    const executableDataBindings = dataBindings.filter((binding) => {
      const keep = reachableNodeIds.has(binding.targetNode)
        && (binding.sourceNode ? reachableNodeIds.has(binding.sourceNode) : true);
      if (!keep) {
        this.logger.warn(
          `Dropping data binding ${binding.id} from execution snapshot because its branch is disabled`,
        );
      }
      return keep;
    });

    return {
      ...snapshot,
      nodes: executableNodes,
      controlEdges: executableControlEdges,
      dataBindings: executableDataBindings,
    };
  }

  private reachableFromOriginalEntrypoints(
    nodes: FlowNode[], controlEdges: ControlEdge[], enabledNodeIds: Set<string>,
  ): Set<string> {
    // Filtering disabled nodes must not turn their successors into new START nodes.
    const originalTargets = new Set(controlEdges.map((edge) => edge.target));
    const successors = new Map<string, string[]>();
    for (const edge of controlEdges) {
      if (!enabledNodeIds.has(edge.source) || !enabledNodeIds.has(edge.target)) continue;
      successors.set(edge.source, [...(successors.get(edge.source) ?? []), edge.target]);
    }
    for (const node of nodes) {
      const container = (node.metadata?.containerConfig ?? node.metadata?.container_config) as
        | { parentIteratorId?: string; parent_iterator_id?: string } | undefined;
      const parentId = container?.parentIteratorId ?? container?.parent_iterator_id;
      if (!parentId) continue;
      originalTargets.add(node.id);
      if (enabledNodeIds.has(parentId) && enabledNodeIds.has(node.id)) {
        successors.set(parentId, [...(successors.get(parentId) ?? []), node.id]);
      }
    }
    const queue = nodes.filter((node) => enabledNodeIds.has(node.id) && !originalTargets.has(node.id))
      .map((node) => node.id);
    const reachable = new Set(queue);
    for (let index = 0; index < queue.length; index++) {
      for (const target of successors.get(queue[index]) ?? []) {
        if (reachable.has(target)) continue;
        reachable.add(target);
        queue.push(target);
      }
    }
    return reachable;
  }

  async buildSeededTaskOutputsForSingleStep(
    flowId: string,
    ownerId: string,
    singleStepTaskId: string,
    currentSnapshot: FlowSnapshot,
    bindings: DataBinding[],
  ): Promise<SeededTaskOutput[]> {
    const requiredBindingHistory = new Map<string, number>();
    for (const binding of bindings) {
      if (binding.sourceKind !== 'node-output' || typeof binding.sourceNode !== 'string' || !binding.sourceNode.trim()) {
        continue;
      }

      const sourceNodeId = binding.sourceNode.trim();
      const requiredCount = binding.iteration === 'previous' ? 2 : 1;
      requiredBindingHistory.set(sourceNodeId, Math.max(requiredBindingHistory.get(sourceNodeId) ?? 0, requiredCount));
    }

    const requiredSourceNodeIds = [...requiredBindingHistory.keys()];

    if (requiredSourceNodeIds.length === 0) {
      return [];
    }

    const currentSnapshotNodes = Array.isArray(currentSnapshot.nodes)
      ? currentSnapshot.nodes as unknown as Record<string, unknown>[]
      : [];

    const completedExecutions = await this.executionRepository.listRecentCompletedWithSnapshot(flowId, ownerId, 20);

    let matchingExecution: (typeof completedExecutions)[number] | null = null;
    for (const exec of completedExecutions) {
      const execSnapshot = exec.snapshot;
      const execSnapshotNodes = Array.isArray(execSnapshot && (execSnapshot as Record<string, unknown>).nodes)
        ? ((execSnapshot as Record<string, unknown>).nodes as Record<string, unknown>[])
        : [];
      const allUpstreamMatch = requiredSourceNodeIds.every((sourceNodeId) => {
        const priorNode = execSnapshotNodes.find((node) => node.id === sourceNodeId);
        const currentNode = currentSnapshotNodes.find((node) => node.id === sourceNodeId);
        return priorNode && currentNode
          && JSON.stringify(comparableNode(priorNode)) === JSON.stringify(comparableNode(currentNode));
      });
      if (allUpstreamMatch) {
        matchingExecution = exec;
        break;
      }
    }

    if (!matchingExecution) {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_VALIDATION_FAILED,
        `Single-step execution for node ${singleStepTaskId} requires a previous completed or failed execution with matching upstream node snapshots.`,
      );
    }

    const taskResults = await this.taskResultRepository.listForExecution(matchingExecution.id, {
      taskIds: requiredSourceNodeIds,
      statuses: ['completed'],
      order: 'latest',
    });

    const resultsByTaskId = new Map<string, Record<string, unknown>[]>();
    for (const result of taskResults) {
      const existing = resultsByTaskId.get(result.taskId) ?? [];
      existing.push(result);
      resultsByTaskId.set(result.taskId, existing);
    }

    const missingSourceNodeIds = requiredSourceNodeIds.filter((taskId) => {
      const requiredCount = requiredBindingHistory.get(taskId) ?? 1;
      return (resultsByTaskId.get(taskId)?.length ?? 0) < requiredCount;
    });
    if (missingSourceNodeIds.length > 0) {
      throw new BadRequestException(
        ErrorCode.PLAYBOOK_FLOW_VALIDATION_FAILED,
        `Single-step execution for node ${singleStepTaskId} requires completed upstream results for: ${missingSourceNodeIds.join(', ')}`,
      );
    }

    return requiredSourceNodeIds.flatMap((taskId) => {
      const requiredCount = requiredBindingHistory.get(taskId) ?? 1;
      const results = (resultsByTaskId.get(taskId) ?? []).slice(0, requiredCount);
      return results.map((result) => ({
        nodeId: taskId,
        iteration: Number(result.iteration ?? 0),
        payload: this.mapTaskResultToSeedPayload(result),
      }));
    });
  }

  private mapTaskResultToSeedPayload(result: Record<string, unknown>): FlowCompletedResultPayload {
    const displayText = typeof result.displayText === 'string' ? result.displayText : undefined;
    const rawOutput = result.output;
    const output = typeof rawOutput === 'string'
      ? rawOutput
      : displayText && displayText.length > 0
        ? displayText
        : JSON.stringify(rawOutput ?? '');

    const outputRecord = rawOutput && typeof rawOutput === 'object'
      ? rawOutput as Record<string, unknown>
      : null;

    let outputs: Record<string, unknown> | undefined;
    if (result.outputs && typeof result.outputs === 'object') {
      outputs = result.outputs as Record<string, unknown>;
    } else if (outputRecord && typeof outputRecord.outputs === 'object' && outputRecord.outputs !== null) {
      outputs = outputRecord.outputs as Record<string, unknown>;
    } else if (typeof result.output === 'string') {
      try {
        const parsed = JSON.parse(result.output);
        if (parsed && typeof parsed === 'object' && parsed.outputs && typeof parsed.outputs === 'object') {
          outputs = parsed.outputs as Record<string, unknown>;
        }
      } catch { /* not JSON or no outputs field */ }
    }

    return {
      output,
      ...(displayText ? { displayText } : {}),
      ...(outputs ? { outputs } : {}),
      ...(Array.isArray(result.artifacts) ? { artifacts: result.artifacts as Record<string, unknown>[] } : {}),
      ...(Array.isArray(result.components) ? { components: result.components as Record<string, unknown>[] } : {}),
      ...(Array.isArray(result.toolTrace) ? { toolTrace: result.toolTrace } : {}),
      ...(Array.isArray(result.reasoningChain) ? { reasoningChain: result.reasoningChain as PublicReasoningTraceItem[] } : {}),
      ...(Array.isArray(result.llmPromptTrace) ? { llmPromptTrace: result.llmPromptTrace } : {}),
      ...(result.usage ? { usage: result.usage } : {}),
      ...(result.semanticMatch ? { semanticMatch: result.semanticMatch } : {}),
      ...(result.traceMetadata ? { traceMetadata: result.traceMetadata as Record<string, unknown> } : {}),
    };
  }
}

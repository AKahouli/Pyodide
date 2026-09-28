import { Injectable } from '@nestjs/common';
import { BadRequestException, ConflictException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { PatchPlaybookFlowDeltaDto } from '../dto/patch-playbook-flow-delta.dto';
import type { DataBinding, FlowNode, ControlEdge } from '../models/playbook-flow.model';
import type { FlowRecord } from '../persistence/flow.repository';
import { FlowWorkspacePolicyService } from './flow-workspace-policy.service';
import { FlowGraphSanitizerService } from './flow-graph-sanitizer.service';

export interface FlowDeltaPatchResult {
  nodes: FlowNode[];
  controlEdges: ControlEdge[];
  dataBindings: DataBinding[];
  normalizedWorkspaces: string[];
  scalarFieldCount: number;
  nodesUpserted: number;
  nodesDeleted: number;
  edgeChanges: number;
  dataBindingChanges: number;
  positionUpdates: number;
}

/**
 * Applies autosave delta payloads against the current flow document before validation and persistence.
 */
@Injectable()
export class FlowDeltaPatchService {
  constructor(
    private readonly workspacePolicy: FlowWorkspacePolicyService,
    private readonly graphSanitizer: FlowGraphSanitizerService,
  ) {}

  buildPatchedGraph(
    flow: Pick<FlowRecord, 'nodes' | 'controlEdges' | 'dataBindings' | 'workspaces'>,
    dto: PatchPlaybookFlowDeltaDto,
  ): FlowDeltaPatchResult {
    const fields = dto.patch.fields;
    const nodeUpserts = dto.patch.nodes?.upserts ?? [];
    const nodeDeleteIds = dto.patch.nodes?.deleteIds ?? [];
    const positionUpdates = dto.patch.nodes?.positionUpdates ?? [];
    const controlEdgesPatch = dto.patch.controlEdges;
    const dataBindingsPatch = dto.patch.dataBindings;

    const unsupportedStructurePatch = Object.keys(dto.patch)
      .some((key) => !['fields', 'nodes', 'controlEdges', 'dataBindings'].includes(key));
    if (unsupportedStructurePatch) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Delta patch requires full refresh.');
    }

    if (
      dto.patch.nodes
      && dto.patch.nodes.positionUpdates === undefined
      && dto.patch.nodes.upserts === undefined
      && dto.patch.nodes.deleteIds === undefined
    ) {
      throw new ConflictException(ErrorCode.CONFLICT, 'Delta patch requires full refresh.');
    }

    if (
      !fields
      && nodeUpserts.length === 0
      && nodeDeleteIds.length === 0
      && positionUpdates.length === 0
      && controlEdgesPatch === undefined
      && dataBindingsPatch === undefined
    ) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Delta patch is empty.');
    }

    const candidateNodesById = new Map(
      flow.nodes.map((node) => [
        node.id,
        { ...node, metadata: { ...(node.metadata ?? {}) } } as FlowNode,
      ]),
    );
    const candidateNodeOrder = flow.nodes.map((node) => node.id);

    for (const deleteId of nodeDeleteIds) {
      if (!candidateNodesById.delete(deleteId)) {
        throw new ConflictException(ErrorCode.CONFLICT, 'Delta patch requires full refresh.');
      }
    }

    const filteredNodeOrder = candidateNodeOrder.filter((nodeId) => candidateNodesById.has(nodeId));

    for (const rawNode of nodeUpserts) {
      const nodeUpsert = rawNode as unknown as FlowNode;
      const candidateNode = {
        ...nodeUpsert,
        metadata: { ...(nodeUpsert.metadata ?? {}) },
      } as FlowNode;
      if (candidateNodesById.has(nodeUpsert.id)) {
        candidateNodesById.set(nodeUpsert.id, candidateNode);
        continue;
      }
      filteredNodeOrder.push(nodeUpsert.id);
      candidateNodesById.set(nodeUpsert.id, candidateNode);
    }

    for (const update of positionUpdates) {
      const candidateNode = candidateNodesById.get(update.id);
      if (!candidateNode) {
        throw new ConflictException(ErrorCode.CONFLICT, 'Delta patch requires full refresh.');
      }
      candidateNode.metadata = {
        ...(candidateNode.metadata ?? {}),
        positionX: update.positionX,
        positionY: update.positionY,
      };
    }

    const nodes = filteredNodeOrder
      .map((nodeId) => candidateNodesById.get(nodeId))
      .filter((node): node is FlowNode => Boolean(node));
    const sanitizedGraph = this.graphSanitizer.sanitize({
      nodes,
      controlEdges: (controlEdgesPatch ?? flow.controlEdges.map((edge) => ({ ...edge }))) as ControlEdge[],
      dataBindings: (dataBindingsPatch ?? flow.dataBindings.map((binding) => ({ ...binding }))) as DataBinding[],
    });

    const normalizedWorkspaces = this.workspacePolicy.normalizeWorkspaces(fields?.workspaces ?? flow.workspaces);

    return {
      nodes,
      controlEdges: sanitizedGraph.controlEdges,
      dataBindings: sanitizedGraph.dataBindings,
      normalizedWorkspaces,
      scalarFieldCount: fields ? Object.keys(fields).length : 0,
      nodesUpserted: nodeUpserts.length,
      nodesDeleted: nodeDeleteIds.length,
      edgeChanges: controlEdgesPatch?.length ?? 0,
      dataBindingChanges: dataBindingsPatch?.length ?? 0,
      positionUpdates: positionUpdates.length,
    };
  }
}

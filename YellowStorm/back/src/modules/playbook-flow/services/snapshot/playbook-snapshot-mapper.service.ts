import { Injectable, Optional } from '@nestjs/common';
import { WorkspaceService } from '../../../workspace/workspace.service';
import { FlowSnapshot } from '../../mappers/flow-to-snapshot.mapper';
import { toGrpcValue } from '../../execution/grpc/grpc-struct.mapper';
import { LoggerService } from '../../../logger';

@Injectable()
export class PlaybookSnapshotMapperService {
  constructor(
    private readonly logger: LoggerService,
    @Optional() private readonly workspaceService?: WorkspaceService,
  ) {
    this.logger.setContext(PlaybookSnapshotMapperService.name);
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
    const executableControlEdges = controlEdges.filter((edge) => {
      const keep = enabledNodeIds.has(edge.source) && enabledNodeIds.has(edge.target);
      if (!keep) {
        this.logger.warn(`Dropping control edge ${edge.id} from execution snapshot because it references a disabled node`);
      }
      return keep;
    });
    const executableDataBindings = dataBindings.filter((binding) => {
      const keep = enabledNodeIds.has(binding.targetNode)
        && (binding.sourceNode ? enabledNodeIds.has(binding.sourceNode) : true);
      if (!keep) {
        this.logger.warn(`Dropping data binding ${binding.id} from execution snapshot because it references a disabled node`);
      }
      return keep;
    });

    return {
      ...snapshot,
      nodes: enabledNodes,
      controlEdges: executableControlEdges,
      dataBindings: executableDataBindings,
    };
  }

  collectBindingWorkspaceIds(dataBindings: any[]): string[] {
    const ids = new Set<string>();
    const scan = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(scan);
        return;
      }
      const workspaceId = (value as Record<string, unknown>).workspaceId;
      if (typeof workspaceId === 'string' && workspaceId) ids.add(workspaceId);
    };
    for (const binding of dataBindings) scan(binding?.constantValue);
    return [...ids];
  }

  enrichConstantValueWithWorkspacePath(
    constantValue: unknown,
    workspacePathsById: Record<string, string>,
  ): unknown {
    const enrichOne = (value: unknown): unknown => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      const record = value as Record<string, unknown>;
      const workspaceId = typeof record.workspaceId === 'string' ? record.workspaceId : '';
      const workspacePath = workspaceId ? workspacePathsById[workspaceId] : undefined;
      return workspacePath ? { ...record, workspacePath } : value;
    };
    if (Array.isArray(constantValue)) return constantValue.map(enrichOne);
    return enrichOne(constantValue);
  }

  async buildDataBindingsProto(
    dataBindings: any[],
    knownWorkspacePaths: Record<string, string> = {},
  ): Promise<any[]> {
    const referenced = this.collectBindingWorkspaceIds(dataBindings);
    const missing = referenced.filter((id) => !(id in knownWorkspacePaths));
    const resolvedMissing = missing.length > 0 && this.workspaceService
      ? await this.workspaceService.getStoragePathMapByIds(missing)
      : {};
    const workspacePathsById = { ...knownWorkspacePaths, ...resolvedMissing };

    return dataBindings.map((b) => ({
      id: b.id,
      target_node: b.targetNode,
      target_port: b.targetPort,
      source_kind: b.sourceKind,
      source_node: b.sourceNode || '',
      source_port: b.sourcePort || '',
      iteration: b.iteration || '',
      trigger_path: b.triggerPath || '',
      state_path: b.statePath || '',
      constant_value: toGrpcValue(
        this.enrichConstantValueWithWorkspacePath(b.constantValue, workspacePathsById),
      ),
      expression: b.expression || '',
    }));
  }
}

function isNodeEnabled(node: any): boolean {
  if (!node || !node.metadata) return true;
  const meta = node.metadata as Record<string, unknown>;
  return (meta as { isEnabled?: boolean }).isEnabled !== false;
}

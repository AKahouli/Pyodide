import { Injectable } from '@nestjs/common';
import { ControlEdge, FlowNode } from '../schemas/playbook-flow.schema';

/**
 * Builds stable gRPC design requests from persisted playbook state and resolved runtime context.
 */
@Injectable()
export class PlaybookDesignRequestBuilderService {
  buildGenerateRequest(params: {
    userId: string;
    query: string;
    modelId: string;
    grpcAgents: unknown[];
    workspaceContexts: unknown[];
    promptOverrides: unknown;
  }) {
    return {
      user_context: { user_id: params.userId, username: params.userId },
      query: params.query,
      available_agents: params.grpcAgents,
      workspace_context: params.workspaceContexts,
      existing_playbook: null,
      model: params.modelId,
      prompt_overrides: params.promptOverrides,
    };
  }

  buildDesignRequest(params: {
    userId: string;
    query: string;
    modelId: string;
    grpcAgents: unknown[];
    workspaceContexts: unknown[];
    promptOverrides: unknown;
    flow: {
      nodes?: FlowNode[];
      controlEdges?: ControlEdge[];
    };
  }) {
    return {
      user_context: { user_id: params.userId, username: params.userId },
      query: params.query,
      available_agents: params.grpcAgents,
      workspace_context: params.workspaceContexts,
      existing_playbook: {
        nodes: (params.flow.nodes || []).map((node) => ({
          id: node.id,
          title: node.label || node.id,
          description: node.description || String(node.metadata?.description || ''),
          assigned_agent_id: String(node.metadata?.assignedAgentId || ''),
          execution_order: 0,
        })),
        edges: (params.flow.controlEdges || []).map((edge) => ({
          source_id: edge.source,
          target_id: edge.target,
          source_output_port_id: edge.sourceOutputPortId || edge.routerLabel || 'default',
          target_input_port_id: edge.targetInputPortId || 'default',
        })),
      },
      model: params.modelId,
      prompt_overrides: params.promptOverrides,
    };
  }
}

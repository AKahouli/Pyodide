import { Injectable } from '@nestjs/common';
import { NotFoundException, ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { PlaybookGrpcService } from '@modules/playbook/services/playbook-grpc.service';
import { PlaybookFlowService } from './playbook-flow.service';
import { FlowNodeAdvisorResponse, FlowNodeAdvisorRequest } from '../interfaces/playbook-flow-advisor.interface';
import { normalizeNodeAdvisorSuggestion } from './playbook-flow-advisor-helpers';

export type { FlowNodeAdvisorResponse, FlowNodeAdvisorRequest };

@Injectable()
export class PlaybookFlowAdvisorService {
  constructor(
    private readonly playbookFlowService: PlaybookFlowService,
    private readonly playbookGrpcService: PlaybookGrpcService,
  ) {}

  async adviseNode(
    flowId: string, nodeId: string, dto: FlowNodeAdvisorRequest,
  ): Promise<FlowNodeAdvisorResponse> {
    if (!this.playbookGrpcService.isAvailable) {
      throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR);
    }

    const flow = await this.playbookFlowService.findById(flowId);
    const node = flow.nodes.find((n: any) => n.id === nodeId);
    if (!node) throw new NotFoundException(ErrorCode.PLAYBOOK_TASK_NOT_FOUND);

    const nodeLabel = (node as any).label || (node as any).title || '';
    const nodeDesc = (node as any).description || '';
    const mergedNode = { ...node, title: dto.title?.trim() || nodeLabel, description: dto.description?.trim() || nodeDesc };

    const request = {
      playbook_id: flow.id,
      task_id: mergedNode.id,
      playbook_name: flow.name,
      target_task: this.toGrpcNode(mergedNode),
      tasks: flow.nodes.map((n: any) => this.toGrpcNode(n)),
      edges: (flow.controlEdges || []).map((edge: any) => ({
        source_id: edge.sourceId, target_id: edge.targetId,
        source_output_port_id: edge.sourceOutputPortId || '',
        target_input_port_id: edge.targetInputPortId || '',
      })),
      suggestion_types: dto.suggestionTypes || ['task_title', 'task_description', 'agent_selection', 'datasource_connection', 'input_contract', 'output_contract', 'general'],
      user_intent: dto.intent?.trim() || '',
      include_graph_context: dto.includeGraphContext !== false,
    };

    const response = await this.playbookGrpcService.advisePlaybookNode(request);

    return {
      flowId: response?.playbook_id || flow.id,
      nodeId: response?.task_id || mergedNode.id,
      suggestions: Array.isArray(response?.suggestions)
        ? response.suggestions.map((s: any, i: number) => normalizeNodeAdvisorSuggestion(s, i))
        : [],
    };
  }

  private toGrpcNode(node: any): Record<string, unknown> {
    return {
      id: node.id, title: node.title || '', description: node.description || '',
      assigned_agent_id: node.assignedAgentId || '',
      execution_order: node.executionOrder || 0,
      execution_mode: node.executionMode || '',
      selected_action: node.selectedAction || '',
      task_type: node.kind || node.nodeType || '',
      input_ports: (node.inputPorts || []).map((p: any) => ({
        id: p.id, name: p.name, artifact_kind: p.artifactKind,
        required: p.required === true, description: p.description || '',
      })),
      output_ports: (node.outputPorts || []).map((p: any) => ({
        id: p.id, name: p.name, artifact_kind: p.artifactKind,
        description: p.description || '',
      })),
    };
  }
}

import { Injectable } from '@nestjs/common';
import { NotFoundException, ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { PlaybookGrpcService } from './playbook-grpc.service';
import {
  PLAYBOOK_NODE_ADVISOR_SUGGESTION_TYPES,
  RequestPlaybookNodeAdvisorDto,
  type PlaybookNodeAdvisorSuggestionType,
} from '../dto/request-playbook-node-advisor.dto';
import type { PlaybookNodeAdvisorResponseDto } from '../dto/playbook-node-advisor-response.dto';
import { PlaybookService } from './playbook.service';

const NODE_ADVISOR_GRPC_TYPE_MAP: Record<number, PlaybookNodeAdvisorSuggestionType> = {
  1: 'task_title',
  2: 'task_description',
  3: 'agent_selection',
  4: 'datasource_connection',
  5: 'input_contract',
  6: 'output_contract',
  7: 'general',
};

@Injectable()
export class PlaybookNodeAdvisorService {
  constructor(
    private readonly playbookService: PlaybookService,
    private readonly playbookGrpcService: PlaybookGrpcService,
  ) {}

  async advise(playbookId: string, taskId: string, dto: RequestPlaybookNodeAdvisorDto): Promise<PlaybookNodeAdvisorResponseDto> {
    if (!this.playbookGrpcService.isAvailable) {
      throw new ServiceUnavailableException(ErrorCode.AI_SERVICE_ERROR);
    }

    const playbook = await this.playbookService.findById(playbookId);
    const task = playbook.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new NotFoundException(ErrorCode.PLAYBOOK_TASK_NOT_FOUND);
    }

    const mergedTask = {
      ...task,
      title: dto.title?.trim() || task.title,
      description: dto.description?.trim() || task.description,
    };

    const request = {
      playbook_id: playbook.id,
      task_id: mergedTask.id,
      playbook_name: playbook.name,
      target_task: this.toGrpcTask(mergedTask),
      tasks: playbook.tasks.map((item) => this.toGrpcTask(item)),
      edges: (playbook.edges || []).map((edge) => ({
        source_id: edge.sourceId,
        target_id: edge.targetId,
        source_output_port_id: edge.sourceOutputPortId || '',
        target_input_port_id: edge.targetInputPortId || '',
      })),
      suggestion_types: this.resolveSuggestionTypes(dto.suggestionTypes),
      user_intent: dto.intent?.trim() || '',
      include_graph_context: dto.includeGraphContext !== false,
    };

    const response = await this.playbookGrpcService.advisePlaybookNode(request);

    return {
      playbookId: response?.playbook_id || playbook.id,
      taskId: response?.task_id || mergedTask.id,
      suggestions: Array.isArray(response?.suggestions)
        ? response.suggestions.map((suggestion: any, index: number) => ({
            id: typeof suggestion?.id === 'string' && suggestion.id ? suggestion.id : `node-advisor-${index}`,
            type: this.normalizeSuggestionType(suggestion?.type),
            title: typeof suggestion?.title === 'string' ? suggestion.title : 'Suggestion',
            summary: typeof suggestion?.summary === 'string' ? suggestion.summary : '',
            rationale: typeof suggestion?.rationale === 'string' ? suggestion.rationale : '',
            confidence: this.normalizeConfidence(suggestion?.confidence),
            patch: suggestion?.patch
              ? {
                  taskTitle: this.normalizeOptionalText(suggestion.patch.task_title),
                  taskDescription: this.normalizeOptionalText(suggestion.patch.task_description),
                  assignedAgentId: this.normalizeOptionalText(suggestion.patch.assigned_agent_id),
                  inputPorts: Array.isArray(suggestion.patch.input_ports)
                    ? suggestion.patch.input_ports.map((port: any) => ({
                        id: String(port?.id || ''),
                        name: String(port?.name || ''),
                        artifactKind: String(port?.artifact_kind || ''),
                        description: this.normalizeOptionalText(port?.description),
                      }))
                    : undefined,
                  outputPorts: Array.isArray(suggestion.patch.output_ports)
                    ? suggestion.patch.output_ports.map((port: any) => ({
                        id: String(port?.id || ''),
                        name: String(port?.name || ''),
                        artifactKind: String(port?.artifact_kind || ''),
                        description: this.normalizeOptionalText(port?.description),
                      }))
                    : undefined,
                  datasourceSuggestions: Array.isArray(suggestion.patch.datasource_suggestions)
                    ? suggestion.patch.datasource_suggestions.map((item: any) => ({
                        sourceTaskId: this.normalizeOptionalText(item?.source_task_id) ?? null,
                        sourceOutputPortId: this.normalizeOptionalText(item?.source_output_port_id) ?? null,
                        targetInputPortId: this.normalizeOptionalText(item?.target_input_port_id) ?? null,
                        datasourceType: this.normalizeOptionalText(item?.datasource_type) ?? null,
                        datasourceId: this.normalizeOptionalText(item?.datasource_id) ?? null,
                        datasourceName: this.normalizeOptionalText(item?.datasource_name) ?? null,
                        rationale: this.normalizeOptionalText(item?.rationale) || '',
                      }))
                    : undefined,
                }
              : undefined,
            warnings: Array.isArray(suggestion?.warnings)
              ? suggestion.warnings.filter((warning: unknown): warning is string => typeof warning === 'string')
              : undefined,
          }))
        : [],
    };
  }

  private resolveSuggestionTypes(types?: PlaybookNodeAdvisorSuggestionType[]): string[] {
    return types?.length ? types : [...PLAYBOOK_NODE_ADVISOR_SUGGESTION_TYPES];
  }

  private normalizeSuggestionType(value: unknown): PlaybookNodeAdvisorSuggestionType {
    if (typeof value === 'number') {
      return NODE_ADVISOR_GRPC_TYPE_MAP[value] || 'general';
    }

    return PLAYBOOK_NODE_ADVISOR_SUGGESTION_TYPES.includes(value as PlaybookNodeAdvisorSuggestionType)
      ? (value as PlaybookNodeAdvisorSuggestionType)
      : 'general';
  }

  private normalizeOptionalText(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  private normalizeConfidence(value: unknown): number {
    if (typeof value !== 'number' || Number.isNaN(value)) return 0.5;
    return Math.max(0, Math.min(1, value));
  }

  private toGrpcTask(task: any): Record<string, unknown> {
    return {
      id: task.id,
      title: task.title || '',
      description: task.description || '',
      assigned_agent_id: task.assignedAgentId || '',
      execution_order: task.executionOrder || 0,
      execution_mode: task.executionMode || '',
      selected_action: task.selectedAction || '',
      task_type: task.taskType || task.nodeType || '',
      input_ports: (task.inputPorts || []).map((port: any) => ({
        id: port.id,
        name: port.name,
        artifact_kind: port.artifactKind,
        required: port.required === true,
        description: port.description || '',
      })),
      output_ports: (task.outputPorts || []).map((port: any) => ({
        id: port.id,
        name: port.name,
        artifact_kind: port.artifactKind,
        description: port.description || '',
      })),
    };
  }
}

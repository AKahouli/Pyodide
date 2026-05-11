import type { PlaybookNodeAdvisorSuggestionType } from './request-playbook-node-advisor.dto';

export interface PlaybookNodeAdvisorPortSuggestionDto {
  id: string;
  name: string;
  artifactKind: string;
  description?: string;
}

export interface PlaybookNodeAdvisorDatasourceSuggestionDto {
  sourceTaskId?: string | null;
  sourceOutputPortId?: string | null;
  targetInputPortId?: string | null;
  datasourceType?: string | null;
  datasourceId?: string | null;
  datasourceName?: string | null;
  rationale: string;
}

export interface PlaybookNodeAdvisorPatchDto {
  taskTitle?: string;
  taskDescription?: string;
  assignedAgentId?: string;
  inputPorts?: PlaybookNodeAdvisorPortSuggestionDto[];
  outputPorts?: PlaybookNodeAdvisorPortSuggestionDto[];
  datasourceSuggestions?: PlaybookNodeAdvisorDatasourceSuggestionDto[];
}

export interface PlaybookNodeAdvisorSuggestionDto {
  id: string;
  type: PlaybookNodeAdvisorSuggestionType;
  title: string;
  summary: string;
  rationale: string;
  confidence: number;
  patch?: PlaybookNodeAdvisorPatchDto;
  warnings?: string[];
}

export interface PlaybookNodeAdvisorResponseDto {
  playbookId: string;
  taskId: string;
  suggestions: PlaybookNodeAdvisorSuggestionDto[];
}

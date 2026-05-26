import type {
  FlowNodeAdvisorSuggestion,
  FlowNodeAdvisorResponse,
  FlowNodeAdvisorRequest,
  FlowExecutionAdvisorConfig,
  FlowExecutionAdvisorStatus,
  FlowExecutionAdvisorTurnEntry,
  FlowAdvisorSuggestionResponse,
} from '../interfaces/playbook-flow-advisor.interface';

export function normalizeAdvisorAutopilotConfig(
  enabled: boolean, targetScore?: number | null, maxTurns?: number | null,
): FlowExecutionAdvisorConfig {
  return {
    enabled,
    targetScore: Number.isFinite(Number(targetScore))
      ? Math.max(1, Math.min(100, Number(targetScore))) : 80,
    maxTurns: Number.isFinite(Number(maxTurns))
      ? Math.max(0, Math.min(5, Math.floor(Number(maxTurns)))) : 2,
  };
}

export function resolveAdvisorAutopilotFixType(judgeResult: any): 'optimize_step' | 'none' {
  if (judgeResult?.safeAutoFixType === 'optimize_step') return 'optimize_step';
  return 'none';
}

export function normalizeNodeAdvisorSuggestion(
  suggestion: any, index: number,
): FlowNodeAdvisorSuggestion {
  return {
    id: typeof suggestion?.id === 'string' && suggestion.id ? suggestion.id : `advisor-${index}`,
    type: normalizeSuggestionType(suggestion?.type),
    title: typeof suggestion?.title === 'string' ? suggestion.title : 'Suggestion',
    summary: typeof suggestion?.summary === 'string' ? suggestion.summary : '',
    rationale: typeof suggestion?.rationale === 'string' ? suggestion.rationale : '',
    confidence: normalizeConfidence(suggestion?.confidence),
    patch: suggestion?.patch ? {
      taskTitle: normalizeOptionalText(suggestion.patch.task_title),
      taskDescription: normalizeOptionalText(suggestion.patch.task_description),
      assignedAgentId: normalizeOptionalText(suggestion.patch.assigned_agent_id),
      inputPorts: Array.isArray(suggestion.patch.input_ports)
        ? suggestion.patch.input_ports.map((p: any) => ({
          id: String(p?.id || ''), name: String(p?.name || ''),
          artifactKind: String(p?.artifact_kind || ''), description: normalizeOptionalText(p?.description),
        })) : undefined,
      outputPorts: Array.isArray(suggestion.patch.output_ports)
        ? suggestion.patch.output_ports.map((p: any) => ({
          id: String(p?.id || ''), name: String(p?.name || ''),
          artifactKind: String(p?.artifact_kind || ''), description: normalizeOptionalText(p?.description),
        })) : undefined,
    } : undefined,
    warnings: Array.isArray(suggestion?.warnings)
      ? suggestion.warnings.filter((w: unknown): w is string => typeof w === 'string') : undefined,
  };
}

function normalizeSuggestionType(value: unknown): FlowNodeAdvisorSuggestion['type'] {
  const valid = ['task_title', 'task_description', 'agent_selection', 'datasource_connection',
    'input_contract', 'output_contract', 'general'];
  return valid.includes(value as string) ? (value as any) : 'general';
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const n = value.trim();
  return n.length > 0 ? n : undefined;
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

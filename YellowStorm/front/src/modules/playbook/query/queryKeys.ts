export type PlaybookDetailView = 'base' | 'enriched';

export const playbookKeys = {
  all: ['playbook'] as const,
  lists: () => [...playbookKeys.all, 'list'] as const,
  list: (query: unknown) => [...playbookKeys.lists(), query] as const,
  flowList: (query: unknown) => [...playbookKeys.lists(), 'flows', query] as const,
  legacyDetail: (id: string) =>
    [...playbookKeys.all, 'legacy-detail', id] as const,
  detail: (id: string, view: PlaybookDetailView) =>
    [...playbookKeys.all, 'detail', id, view] as const,
  designMessages: (playbookId: string) =>
    [...playbookKeys.legacyDetail(playbookId), 'design-messages'] as const,
  designOperation: (playbookId: string, operationId: string) =>
    [...playbookKeys.detail(playbookId, 'enriched'), 'design-operation', operationId] as const,
  executions: (playbookId: string) =>
    [...playbookKeys.all, 'executions', playbookId] as const,
  execution: (executionId: string) =>
    [...playbookKeys.all, 'execution', executionId] as const,
  activeExecutions: () =>
    [...playbookKeys.all, 'active-executions'] as const,
  nodeTemplates: () =>
    [...playbookKeys.all, 'node-templates'] as const,
  templates: () =>
    [...playbookKeys.all, 'templates'] as const,
  flowNodeKinds: () =>
    [...playbookKeys.all, 'flow-node-kinds'] as const,
  replays: (playbookId: string, taskId: string) =>
    [...playbookKeys.detail(playbookId, 'enriched'), 'replays', taskId] as const,
  flowReplays: (flowId: string, taskId: string) =>
    [...playbookKeys.detail(flowId, 'enriched'), 'flow-replays', taskId] as const,
  repeatability: (playbookId: string, limit: number, offset: number) =>
    [...playbookKeys.detail(playbookId, 'enriched'), 'repeatability', { limit, offset }] as const,
  flowRepeatability: (flowId: string) =>
    [...playbookKeys.detail(flowId, 'enriched'), 'flow-repeatability'] as const,
  taskRepeatability: (playbookId: string, taskId: string) =>
    [...playbookKeys.detail(playbookId, 'enriched'), 'task-repeatability', taskId] as const,
  flowTaskRepeatability: (flowId: string, taskId: string) =>
    [...playbookKeys.detail(flowId, 'enriched'), 'flow-task-repeatability', taskId] as const,
  outputFormatTemplate: (playbookId: string, taskId: string) =>
    [...playbookKeys.detail(playbookId, 'enriched'), 'output-format-template', taskId] as const,
  flowOutputFormatTemplate: (flowId: string, taskId: string) =>
    [...playbookKeys.detail(flowId, 'enriched'), 'flow-output-format-template', taskId] as const,
  evaluationExecutions: (playbookId: string, taskId?: string) =>
    [...playbookKeys.legacyDetail(playbookId), 'evaluation-executions', taskId ?? null] as const,
  evaluationBaseline: (playbookId: string, taskId: string) =>
    [...playbookKeys.legacyDetail(playbookId), 'evaluation-baseline', taskId] as const,
  flowEvaluationExecutions: (flowId: string, taskId?: string) =>
    [...playbookKeys.detail(flowId, 'enriched'), 'flow-evaluation-executions', taskId ?? null] as const,
  flowEvaluationBaseline: (flowId: string, taskId: string) =>
    [...playbookKeys.detail(flowId, 'enriched'), 'flow-evaluation-baseline', taskId] as const,
  advisorRemediations: (playbookId: string, executionId: string, taskId?: string) =>
    [...playbookKeys.execution(executionId), 'advisor-remediations', playbookId, taskId ?? null] as const,
  flowTriggers: (flowId: string) =>
    [...playbookKeys.detail(flowId, 'enriched'), 'triggers'] as const,
};

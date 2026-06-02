import * as api from '@/modules/playbook/api';
import { playbookQueryClient } from '@/modules/playbook/query/queryClient';
import { playbookKeys } from '@/modules/playbook/query/queryKeys';

export type UpdatePlaybookVariables = {
  id: string;
  data: Parameters<typeof api.updatePlaybook>[1];
};

export type PatchFlowDeltaVariables = {
  id: string;
  data: Parameters<typeof api.patchFlowDelta>[1];
  idempotencyKey?: string;
};

export type StartExecutionVariables = {
  flowId: string;
  inputContext?: Parameters<typeof api.startFlowExecution>[1];
  idempotencyKey?: string;
  options?: Parameters<typeof api.startFlowExecution>[3];
};

export type ResumeApprovalVariables = {
  executionId: string;
  decision: string;
  payload?: Record<string, unknown>;
};

export type ResumeFromStepVariables = {
  playbookId: string;
  executionId: string;
  data: Parameters<typeof api.resumePlaybookFromStep>[2];
};

export type ValidateReplayVariables = {
  playbookId: string;
  taskId: string;
  data: Parameters<typeof api.validateTaskReplay>[2];
};

export type ValidateFlowReplayVariables = {
  flowId: string;
  taskId: string;
  data: Parameters<typeof api.validateFlowTaskReplay>[2];
};

export type UpdateOutputFormatTemplateVariables = {
  playbookId: string;
  taskId: string;
  data: Parameters<typeof api.updateOutputFormatTemplate>[2];
};

export type UpdateFlowOutputFormatTemplateVariables = {
  flowId: string;
  taskId: string;
  data: Parameters<typeof api.updateFlowOutputFormatTemplate>[2];
};

export type UpsertScheduleVariables = {
  flowId: string;
  data: Record<string, unknown>;
};

export type UpsertMailVariables = {
  flowId: string;
  data: Record<string, unknown>;
};

export type DesignFlowVariables = {
  flowId: string;
  data: Parameters<typeof api.designFlow>[1];
};

export type StartDesignOperationVariables = {
  flowId: string;
  data: Parameters<typeof api.startDesignOperation>[1];
};

export type UpdateHitlPolicyVariables = {
  flowId: string;
  nodeId?: string | null;
  data: Parameters<typeof api.updateHitlPolicy>[1];
};

export type CreateHitlBlockerVariables = {
  flowId: string;
  data: Parameters<typeof api.createHitlBlocker>[1];
};

export type UpdateHitlBlockerVariables = {
  flowId: string;
  blockerId: string;
  data: Parameters<typeof api.updateHitlBlocker>[2];
};

export type DeleteHitlBlockerVariables = {
  flowId: string;
  blockerId: string;
};

/** Runs playbook creation and refreshes list buckets that may now include the new summary. */
export async function createPlaybookMutation(data: Parameters<typeof api.createPlaybook>[0]) {
  const playbook = await api.createPlaybook(data);
  playbookQueryClient.setQueryData(playbookKeys.legacyDetail(playbook.id), playbook);
  await playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.lists() });
  return playbook;
}

/** Saves a full playbook payload and keeps base detail/list caches aligned with the server copy. */
export async function updatePlaybookMutation({ id, data }: UpdatePlaybookVariables) {
  const playbook = await api.updatePlaybook(id, data);
  playbookQueryClient.setQueryData(playbookKeys.legacyDetail(id), playbook);
  playbookQueryClient.setQueryData(playbookKeys.detail(id, 'base'), playbook);
  await Promise.all([
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.detail(id, 'enriched') }),
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.lists() }),
  ]);
  return playbook;
}

/** Saves an autosave delta and invalidates reads that depend on the persisted graph snapshot. */
export async function patchFlowDeltaMutation({ id, data, idempotencyKey }: PatchFlowDeltaVariables) {
  const result = await api.patchFlowDelta(id, data, idempotencyKey);
  await Promise.all([
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.detail(id, 'base') }),
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.detail(id, 'enriched') }),
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.lists() }),
  ]);
  return result;
}

/** Removes a playbook from detail caches before refreshing list buckets. */
export async function deletePlaybookMutation(id: string) {
  const result = await api.deletePlaybook(id);
  playbookQueryClient.removeQueries({ queryKey: playbookKeys.legacyDetail(id) });
  playbookQueryClient.removeQueries({ queryKey: playbookKeys.detail(id, 'base') });
  playbookQueryClient.removeQueries({ queryKey: playbookKeys.detail(id, 'enriched') });
  await playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.lists() });
  return result;
}

/** Caches the cloned playbook detail immediately and refreshes list summaries. */
export async function clonePlaybookMutation(id: string) {
  const playbook = await api.clonePlaybook(id);
  playbookQueryClient.setQueryData(playbookKeys.legacyDetail(playbook.id), playbook);
  playbookQueryClient.setQueryData(playbookKeys.detail(playbook.id, 'base'), playbook);
  await playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.lists() });
  return playbook;
}

/** Starts an execution and invalidates active/history reads without mutating local UI state. */
export async function startExecutionMutation(variables: StartExecutionVariables) {
  const result = await api.startFlowExecution(
    variables.flowId,
    variables.inputContext,
    variables.idempotencyKey,
    variables.options,
  );
  await Promise.all([
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.activeExecutions() }),
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.executions(variables.flowId) }),
  ]);
  return result;
}

/** Cancels an execution and refreshes active execution caches that determine UI controls. */
export async function cancelExecutionMutation(executionId: string) {
  const result = await api.cancelFlowExecution(executionId);
  await Promise.all([
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.execution(executionId) }),
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.activeExecutions() }),
  ]);
  return result;
}

/** Resumes a HITL approval and refreshes the execution caches affected by the transition. */
export async function resumeApprovalMutation({ executionId, decision, payload }: ResumeApprovalVariables) {
  const result = await api.resumeFlowApproval(executionId, decision, payload);
  await Promise.all([
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.execution(executionId) }),
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.activeExecutions() }),
  ]);
  return result;
}

/** Resumes from a step and refreshes both the old interrupted execution and new run. */
export async function resumeFromStepMutation(variables: ResumeFromStepVariables) {
  const result = await api.resumePlaybookFromStep(variables.playbookId, variables.executionId, variables.data);
  await Promise.all([
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.execution(variables.executionId) }),
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.execution(result.executionId) }),
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.executions(variables.playbookId) }),
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.activeExecutions() }),
  ]);
  return result;
}

/** Validates replay output and refreshes replay/enriched reads that surface replay metadata. */
export async function validateReplayMutation({ playbookId, taskId, data }: ValidateReplayVariables) {
  const replay = await api.validateTaskReplay(playbookId, taskId, data);
  await Promise.all([
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.replays(playbookId, taskId) }),
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.detail(playbookId, 'enriched') }),
  ]);
  return replay;
}

/** Validates flow replay output and refreshes flow replay/enriched reads. */
export async function validateFlowReplayMutation({ flowId, taskId, data }: ValidateFlowReplayVariables) {
  const replay = await api.validateFlowTaskReplay(flowId, taskId, data);
  await Promise.all([
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.flowReplays(flowId, taskId) }),
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.detail(flowId, 'enriched') }),
  ]);
  return replay;
}

/** Updates output template cache directly because the endpoint returns the persisted template. */
export async function updateOutputFormatTemplateMutation({
  playbookId,
  taskId,
  data,
}: UpdateOutputFormatTemplateVariables) {
  const template = await api.updateOutputFormatTemplate(playbookId, taskId, data);
  playbookQueryClient.setQueryData(playbookKeys.outputFormatTemplate(playbookId, taskId), template);
  await playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.detail(playbookId, 'enriched') });
  return template;
}

/** Updates flow output template cache directly because the endpoint returns the persisted template. */
export async function updateFlowOutputFormatTemplateMutation({
  flowId,
  taskId,
  data,
}: UpdateFlowOutputFormatTemplateVariables) {
  const template = await api.updateFlowOutputFormatTemplate(flowId, taskId, data);
  playbookQueryClient.setQueryData(playbookKeys.flowOutputFormatTemplate(flowId, taskId), template);
  await playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.detail(flowId, 'enriched') });
  return template;
}

/** Persists schedule triggers and refreshes trigger/detail/list reads that display scheduling state. */
export async function upsertTriggerScheduleMutation({ flowId, data }: UpsertScheduleVariables) {
  const result = await api.upsertFlowTriggerSchedule(flowId, data);
  await Promise.all([
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.flowTriggers(flowId) }),
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.detail(flowId, 'base') }),
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.lists() }),
  ]);
  return result;
}

/** Persists mail triggers and refreshes trigger/detail reads that show subscription state. */
export async function upsertTriggerMailMutation({ flowId, data }: UpsertMailVariables) {
  const result = await api.upsertFlowTriggerMail(flowId, data);
  await Promise.all([
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.flowTriggers(flowId) }),
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.detail(flowId, 'base') }),
  ]);
  return result;
}

/** Runs the synchronous design endpoint while invalidating design messages and flow details. */
export async function designFlowMutation({ flowId, data }: DesignFlowVariables) {
  const result = await api.designFlow(flowId, data);
  await Promise.all([
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.detail(flowId, 'base') }),
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.detail(flowId, 'enriched') }),
    playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.designMessages(flowId) }),
  ]);
  return result;
}

export async function startDesignOperationMutation({ flowId, data }: StartDesignOperationVariables) {
  const operation = await api.startDesignOperation(flowId, data);
  await playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.designOperation(flowId, operation.id) });
  return operation;
}

export async function updateHitlPolicyMutation({ flowId, nodeId, data }: UpdateHitlPolicyVariables) {
  const policy = nodeId
    ? await api.updateNodeHitlPolicy(flowId, nodeId, data)
    : await api.updateHitlPolicy(flowId, data);
  playbookQueryClient.setQueryData(playbookKeys.hitlPolicy(flowId, nodeId), policy);
  await playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.detail(flowId, 'base') });
  return policy;
}

export async function createHitlBlockerMutation({ flowId, data }: CreateHitlBlockerVariables) {
  const blocker = await api.createHitlBlocker(flowId, data);
  await playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.hitlBlockers(flowId) });
  return blocker;
}

export async function updateHitlBlockerMutation({ flowId, blockerId, data }: UpdateHitlBlockerVariables) {
  const blocker = await api.updateHitlBlocker(flowId, blockerId, data);
  await playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.hitlBlockers(flowId) });
  return blocker;
}

export async function deleteHitlBlockerMutation({ flowId, blockerId }: DeleteHitlBlockerVariables) {
  const result = await api.deleteHitlBlocker(flowId, blockerId);
  await playbookQueryClient.invalidateQueries({ queryKey: playbookKeys.hitlBlockers(flowId) });
  return result;
}

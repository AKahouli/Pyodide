/**
 * Playbook API Functions
 */

import apiClient, { type ApiResponse } from '@/lib/api/client';
import { API_CONFIG, API_ENDPOINTS, AUTH_STORAGE_KEYS } from '@/lib/api/config';
import type {
  Playbook,
  PlaybookSummary,
  PlaybookQueryParams,
  PlaybookExecution,
  PlaybookExecutionSummary,
  DesignMessage,
  CreatePlaybookData,
  GeneratePlaybookData,
  RewritePlaybookPromptData,
  RewritePlaybookPromptResult,
  DesignPlaybookData,
  UpdatePlaybookData,
  ExecutePlaybookData,
  ResumePlaybookData,
  RerunStepData,
  CloneShareResult,
  PlaybookTriggersData,
  SyncPlaybookMailSubscriptionData,
  UpsertPlaybookMailTriggerData,
  UpsertPlaybookScheduleData,
  ValidateTaskReplayData,
  ValidatedTaskReplay,
  UpdateTaskReplayFormatData,
  GrabOutputFormatTemplateData,
  UpdateOutputFormatTemplateData,
  OutputFormatTemplate,
  AdvisorRemediationItem,
  ApplyRemediationsData,
  PlaybookEvaluationBaseline,
  PlaybookEvaluationExecution,
  PlaybookRepeatabilitySummary,
  TaskRepeatabilityResult,
} from './types';

interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

function sanitizePlaybookUpdate(data: UpdatePlaybookData): UpdatePlaybookData {
  if (!data.tasks) {
    return data;
  }

  return {
    ...data,
    tasks: data.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      assignedAgentId: task.assignedAgentId,
      executionMode: task.executionMode,
      selectedAction: task.selectedAction,
      executionOrder: task.executionOrder,
      positionX: task.positionX,
      positionY: task.positionY,
      interruptBefore: task.interruptBefore,
      interruptAfter: task.interruptAfter,
      allowClarification: task.allowClarification,
      clarificationPrompt: task.clarificationPrompt,
      maxClarifications: task.maxClarifications,
      inputKeys: task.inputKeys,
      outputKey: task.outputKey,
      enabled: task.enabled,
      notifyOnComplete: task.notifyOnComplete,
      notifyEmails: task.notifyEmails,
      stepReplayMode: task.stepReplayMode,
      inputFiles: task.inputFiles?.map((f) => ({
        type: f.type,
        id: f.id,
        name: f.name,
        workspaceId: f.workspaceId,
        portId: f.portId,
        metadata: f.metadata ? {
          workspaceId: f.metadata.workspaceId,
          documentId: f.metadata.documentId,
          filename: f.metadata.filename,
          filepath: f.metadata.filepath,
          language: f.metadata.language,
          mimeType: f.metadata.mimeType,
        } : undefined,
      })),
      taskType: task.taskType,
      inputPorts: task.inputPorts,
      outputPorts: task.outputPorts,
      toolBindings: task.toolBindings,
      evaluationConfig: task.evaluationConfig
        ? {
            expectation: task.evaluationConfig.expectation,
            referenceBaselineId: task.evaluationConfig.referenceBaselineId ?? null,
            passThreshold: task.evaluationConfig.passThreshold,
            warningThreshold: task.evaluationConfig.warningThreshold,
            weight: task.evaluationConfig.weight,
            rubricVersion: task.evaluationConfig.rubricVersion,
            weights: { ...task.evaluationConfig.weights },
          }
        : null,
      expectedResult: task.expectedResult,
      disableAdvisorEvaluation: task.disableAdvisorEvaluation,
    })),
  };
}

function sanitizePlaybookSettings(data: UpdatePlaybookData): UpdatePlaybookData {
  return {
    ...data,
    tasks: data.tasks?.map((task) => ({
      ...task,
      evaluationConfig: task.evaluationConfig
        ? {
            expectation: task.evaluationConfig.expectation,
            referenceBaselineId: task.evaluationConfig.referenceBaselineId ?? null,
            passThreshold: task.evaluationConfig.passThreshold,
            warningThreshold: task.evaluationConfig.warningThreshold,
            weight: task.evaluationConfig.weight,
            rubricVersion: task.evaluationConfig.rubricVersion,
            weights: { ...task.evaluationConfig.weights },
          }
        : null,
    })),
    reflectionEnabled: data.reflectionEnabled,
    advisorAutopilotEnabled: data.advisorAutopilotEnabled,
    advisorAutopilotTargetScore: data.advisorAutopilotTargetScore,
    advisorAutopilotMaxTurns: data.advisorAutopilotMaxTurns,
  };
}

function sanitizeValidateReplayData(data: ValidateTaskReplayData): ValidateTaskReplayData {
  return {
    executionId: data.executionId,
    preserveOutputFormat: Boolean(data.preserveOutputFormat),
  };
}

export async function getPlaybooks(
  query?: PlaybookQueryParams,
): Promise<{ playbooks: PlaybookSummary[]; pagination: PaginatedResponse<PlaybookSummary>['pagination'] }> {
  const response = await apiClient.get<
    ApiResponse<{ playbooks: PlaybookSummary[]; pagination: PaginatedResponse<PlaybookSummary>['pagination'] }>
  >(API_ENDPOINTS.playbooks.list, { params: query });
  return response.data.data;
}

export async function getPlaybook(id: string): Promise<Playbook> {
  const response = await apiClient.get<ApiResponse<Playbook>>(
    API_ENDPOINTS.playbooks.byId(id),
  );
  return response.data.data;
}

export async function createPlaybook(data: CreatePlaybookData): Promise<Playbook> {
  const response = await apiClient.post<ApiResponse<Playbook>>(
    API_ENDPOINTS.playbooks.list,
    data,
  );
  return response.data.data;
}

export async function generatePlaybook(
  data: GeneratePlaybookData,
): Promise<{ id: string }> {
  const response = await apiClient.post<ApiResponse<{ id: string }>>(
    API_ENDPOINTS.playbooks.generate,
    data,
  );
  return response.data.data;
}

export async function rewritePlaybookPrompt(
  data: RewritePlaybookPromptData,
): Promise<RewritePlaybookPromptResult> {
  const response = await apiClient.post<ApiResponse<RewritePlaybookPromptResult>>(
    API_ENDPOINTS.playbooks.rewritePrompt,
    data,
  );
  return response.data.data;
}

export async function rewritePlaybookPromptStream(
  data: RewritePlaybookPromptData,
  onChunk: (chunk: string) => void,
): Promise<RewritePlaybookPromptResult> {
  const token = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
  const response = await fetch(`${API_CONFIG.baseURL}${API_ENDPOINTS.playbooks.rewritePrompt}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(data),
    credentials: 'include',
  });

  if (!response.ok || !response.body) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    if (!chunk) continue;
    fullText += chunk;
    onChunk(chunk);
  }

  fullText += decoder.decode();
  return { prompt: fullText.trim() };
}

export async function updatePlaybook(
  id: string,
  data: UpdatePlaybookData,
): Promise<Playbook> {
  const response = await apiClient.patch<ApiResponse<Playbook>>(
    API_ENDPOINTS.playbooks.byId(id),
    sanitizePlaybookSettings(sanitizePlaybookUpdate(data)),
  );
  return response.data.data;
}

export async function updatePlaybookFromJudge(id: string, executionId: string): Promise<Playbook> {
  const response = await apiClient.post<ApiResponse<Playbook>>(
    `${API_ENDPOINTS.playbooks.byId(id)}/judge/update-current`,
    { executionId },
  );
  return response.data.data;
}

export async function generatePlaybookFromJudge(id: string, executionId: string): Promise<Playbook> {
  const response = await apiClient.post<ApiResponse<Playbook>>(
    `${API_ENDPOINTS.playbooks.byId(id)}/judge/generate-new`,
    { executionId },
  );
  return response.data.data;
}

export async function optimizeStepFromJudge(id: string, executionId: string, taskId: string): Promise<Playbook> {
  const response = await apiClient.post<ApiResponse<Playbook>>(
    `${API_ENDPOINTS.playbooks.byId(id)}/judge/optimize-step`,
    { executionId, taskId },
  );
  return response.data.data;
}

export async function fetchAdvisorRemediations(
  playbookId: string,
  executionId: string,
  taskId?: string,
): Promise<AdvisorRemediationItem[]> {
  const params = taskId ? { taskId } : {};
  const response = await apiClient.get<ApiResponse<AdvisorRemediationItem[]>>(
    `${API_ENDPOINTS.playbooks.byId(playbookId)}/executions/${executionId}/advisor-remediations`,
    { params },
  );
  return response.data.data;
}

export async function applyAdvisorRemediations(
  playbookId: string,
  executionId: string,
  data: ApplyRemediationsData,
): Promise<Playbook> {
  const response = await apiClient.post<ApiResponse<Playbook>>(
    `${API_ENDPOINTS.playbooks.byId(playbookId)}/executions/${executionId}/advisor-remediations/apply`,
    data,
  );
  return response.data.data;
}

export async function deletePlaybook(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.playbooks.byId(id));
}

export async function executePlaybook(
  id: string,
  data?: ExecutePlaybookData,
): Promise<{ executionId: string }> {
  const response = await apiClient.post<ApiResponse<{ executionId: string }>>(
    API_ENDPOINTS.playbooks.execute(id),
    data || {},
  );
  return response.data.data;
}

export async function getPlaybookIntegrationToken(id: string): Promise<{ token: string }> {
  const response = await apiClient.post<ApiResponse<{ token: string }>>(
    API_ENDPOINTS.playbooks.integrationLink(id),
  );
  return response.data.data;
}

export async function resumePlaybook(
  id: string,
  data: ResumePlaybookData,
): Promise<{ status: string }> {
  const response = await apiClient.post<ApiResponse<{ status: string }>>(
    API_ENDPOINTS.playbooks.resume(id),
    data,
  );
  return response.data.data;
}

export async function stopPlaybook(
  id: string,
  data: { executionId: string },
): Promise<{ status: string }> {
  const response = await apiClient.post<ApiResponse<{ status: string }>>(
    API_ENDPOINTS.playbooks.stop(id),
    data,
  );
  return response.data.data;
}

export async function skipPlaybookStep(
  id: string,
  data: { executionId: string; taskId: string },
): Promise<{ status: string }> {
  const response = await apiClient.post<ApiResponse<{ status: string }>>(
    API_ENDPOINTS.playbooks.skipStep(id),
    data,
  );
  return response.data.data;
}

export async function rerunPlaybookStep(
  playbookId: string,
  executionId: string,
  data: RerunStepData,
): Promise<{ status: string; executionId: string }> {
  const response = await apiClient.post<ApiResponse<{ status: string; executionId: string }>>(
    API_ENDPOINTS.playbooks.rerunStep(playbookId, executionId),
    data,
  );
  return response.data.data;
}

export async function resumePlaybookFromStep(
  playbookId: string,
  executionId: string,
  data: { taskId: string; streaming?: boolean },
): Promise<{ status: string; executionId: string }> {
  const response = await apiClient.post<ApiResponse<{ status: string; executionId: string }>>(
    API_ENDPOINTS.playbooks.resumeFromStep(playbookId, executionId),
    data,
  );
  return response.data.data;
}

export async function validateTaskReplay(
  playbookId: string,
  taskId: string,
  data: ValidateTaskReplayData,
): Promise<ValidatedTaskReplay> {
  const response = await apiClient.post<ApiResponse<ValidatedTaskReplay>>(
    API_ENDPOINTS.playbooks.validateReplay(playbookId, taskId),
    sanitizeValidateReplayData(data),
  );
  return response.data.data;
}

export async function getTaskReplays(
  playbookId: string,
  taskId: string,
): Promise<ValidatedTaskReplay[]> {
  const response = await apiClient.get<ApiResponse<ValidatedTaskReplay[]>>(
    API_ENDPOINTS.playbooks.replays(playbookId, taskId),
  );
  return response.data.data;
}

export async function activateTaskReplay(
  playbookId: string,
  taskId: string,
  replayId: string,
): Promise<ValidatedTaskReplay> {
  const response = await apiClient.post<ApiResponse<ValidatedTaskReplay>>(
    API_ENDPOINTS.playbooks.activateReplay(playbookId, taskId, replayId),
  );
  return response.data.data;
}

export async function updateTaskReplayFormatGuide(
  playbookId: string,
  taskId: string,
  replayId: string,
  data: UpdateTaskReplayFormatData,
): Promise<ValidatedTaskReplay> {
  const response = await apiClient.patch<ApiResponse<ValidatedTaskReplay>>(
    API_ENDPOINTS.playbooks.updateReplayFormatGuide(playbookId, taskId, replayId),
    data,
  );
  return response.data.data;
}

export async function grabOutputFormatTemplate(
  playbookId: string,
  taskId: string,
  data: GrabOutputFormatTemplateData,
): Promise<OutputFormatTemplate> {
  const response = await apiClient.post<ApiResponse<OutputFormatTemplate>>(
    API_ENDPOINTS.playbooks.grabOutputFormatTemplate(playbookId, taskId),
    data,
  );
  return response.data.data;
}

export async function getOutputFormatTemplate(
  playbookId: string,
  taskId: string,
): Promise<OutputFormatTemplate | null> {
  const response = await apiClient.get<ApiResponse<OutputFormatTemplate | null>>(
    API_ENDPOINTS.playbooks.outputFormatTemplate(playbookId, taskId),
  );
  return response.data.data;
}

export async function updateOutputFormatTemplate(
  playbookId: string,
  taskId: string,
  data: UpdateOutputFormatTemplateData,
): Promise<OutputFormatTemplate> {
  const response = await apiClient.patch<ApiResponse<OutputFormatTemplate>>(
    API_ENDPOINTS.playbooks.outputFormatTemplate(playbookId, taskId),
    data,
  );
  return response.data.data;
}

export async function getEvaluationExecutions(playbookId: string, taskId?: string): Promise<PlaybookEvaluationExecution[]> {
  const response = await apiClient.get<ApiResponse<PlaybookEvaluationExecution[]>>(
    `${API_ENDPOINTS.playbooks.byId(playbookId)}/evaluations`,
    { params: taskId ? { taskId } : {} },
  );
  return response.data.data;
}

export async function getEvaluationBaseline(playbookId: string, taskId: string): Promise<PlaybookEvaluationBaseline | null> {
  const response = await apiClient.get<ApiResponse<PlaybookEvaluationBaseline | null>>(
    `${API_ENDPOINTS.playbooks.byId(playbookId)}/evaluation-tasks/${taskId}/baseline`,
  );
  return response.data.data;
}

export async function createEvaluationBaselineFromExecution(playbookId: string, taskId: string, executionId: string): Promise<PlaybookEvaluationBaseline> {
  const response = await apiClient.post<ApiResponse<PlaybookEvaluationBaseline>>(
    `${API_ENDPOINTS.playbooks.byId(playbookId)}/evaluation-tasks/${taskId}/baseline/from-execution`,
    { executionId },
  );
  return response.data.data;
}

export async function createEvaluationBaselineFromCurrentExecution(
  playbookId: string,
  taskId: string,
  executionId: string,
  evaluationExecutionId: string,
): Promise<PlaybookEvaluationBaseline> {
  const response = await apiClient.post<ApiResponse<PlaybookEvaluationBaseline>>(
    `${API_ENDPOINTS.playbooks.byId(playbookId)}/evaluation-tasks/${taskId}/baseline/from-current-execution`,
    { executionId, evaluationExecutionId },
  );
  return response.data.data;
}

export async function deleteOutputFormatTemplate(
  playbookId: string,
  taskId: string,
): Promise<{ removed: boolean }> {
  const response = await apiClient.delete<ApiResponse<{ removed: boolean }>>(
    API_ENDPOINTS.playbooks.outputFormatTemplate(playbookId, taskId),
  );
  return response.data.data;
}

export async function designPlaybook(
  id: string,
  data: DesignPlaybookData,
): Promise<{ playbook: Playbook | null; message: DesignMessage }> {
  const response = await apiClient.post<ApiResponse<{ playbook: Playbook | null; message: DesignMessage }>>(
    API_ENDPOINTS.playbooks.design(id),
    data,
  );
  return response.data.data;
}

export async function getDesignMessages(id: string): Promise<DesignMessage[]> {
  const response = await apiClient.get<ApiResponse<DesignMessage[]>>(
    API_ENDPOINTS.playbooks.designMessages(id),
  );
  return response.data.data;
}

export async function revertToSnapshot(
  id: string,
  msgId: string,
): Promise<{ playbook: Playbook; message: DesignMessage }> {
  const response = await apiClient.post<ApiResponse<{ playbook: Playbook; message: DesignMessage }>>(
    API_ENDPOINTS.playbooks.revertDesign(id, msgId),
  );
  return response.data.data;
}

export async function getExecutions(
  playbookId: string,
  query?: Record<string, unknown>,
): Promise<{ executions: PlaybookExecutionSummary[]; pagination: PaginatedResponse<PlaybookExecutionSummary>['pagination'] }> {
  const response = await apiClient.get<
    ApiResponse<{ executions: PlaybookExecutionSummary[]; pagination: PaginatedResponse<PlaybookExecutionSummary>['pagination'] }>
  >(API_ENDPOINTS.playbooks.executions(playbookId), { params: query });
  return response.data.data;
}

export async function getExecution(
  playbookId: string,
  executionId: string,
): Promise<PlaybookExecution> {
  const response = await apiClient.get<ApiResponse<PlaybookExecution>>(
    API_ENDPOINTS.playbooks.execution(playbookId, executionId),
  );
  return response.data.data;
}

export async function deleteExecution(
  playbookId: string,
  executionId: string,
): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.playbooks.deleteExecution(playbookId, executionId));
}

export async function deleteStepExecution(
  playbookId: string,
  executionId: string,
  taskId: string,
  stepExecutionId: string,
): Promise<void> {
  await apiClient.delete(
    API_ENDPOINTS.playbooks.deleteStepExecution(playbookId, executionId, taskId, stepExecutionId),
  );
}

export async function deleteAllExecutions(
  playbookId: string,
): Promise<{ deleted: number; kept: number }> {
  const response = await apiClient.delete<ApiResponse<{ deleted: number; kept: number }>>(
    API_ENDPOINTS.playbooks.deleteAllExecutions(playbookId),
  );
  return response.data.data;
}

export async function toggleFavorite(id: string): Promise<{ isFavorite: boolean }> {
  const response = await apiClient.post<ApiResponse<{ isFavorite: boolean }>>(
    API_ENDPOINTS.playbooks.favorite(id),
  );
  return response.data.data;
}

export async function bulkDeletePlaybooks(ids: string[]): Promise<{ deleted: number }> {
  const response = await apiClient.post<ApiResponse<{ deleted: number }>>(
    API_ENDPOINTS.playbooks.bulkDelete,
    { ids },
  );
  return response.data.data;
}

export async function getActiveExecutions(): Promise<PlaybookExecution[]> {
  const response = await apiClient.get<ApiResponse<PlaybookExecution[]>>(
    API_ENDPOINTS.playbooks.activeExecutions,
  );
  return response.data.data;
}

export async function upsertPlaybookTriggerSchedule(
  playbookId: string,
  data: UpsertPlaybookScheduleData,
): Promise<Playbook> {
  const response = await apiClient.put<ApiResponse<Playbook>>(
    API_ENDPOINTS.playbooks.triggerSchedule(playbookId),
    data,
  );
  return response.data.data;
}

export async function clearPlaybookTriggerSchedule(playbookId: string): Promise<Playbook> {
  const response = await apiClient.delete<ApiResponse<Playbook>>(
    API_ENDPOINTS.playbooks.triggerSchedule(playbookId),
  );
  return response.data.data;
}

export async function getPlaybookTriggers(playbookId: string): Promise<PlaybookTriggersData> {
  const response = await apiClient.get<ApiResponse<PlaybookTriggersData>>(
    API_ENDPOINTS.playbooks.triggers(playbookId),
  );
  return response.data.data;
}

export async function upsertPlaybookTriggerMail(
  playbookId: string,
  data: UpsertPlaybookMailTriggerData,
): Promise<Playbook> {
  const response = await apiClient.put<ApiResponse<Playbook>>(
    API_ENDPOINTS.playbooks.triggerMail(playbookId),
    data,
  );
  return response.data.data;
}

export async function clearPlaybookTriggerMail(playbookId: string): Promise<Playbook> {
  const response = await apiClient.delete<ApiResponse<Playbook>>(
    API_ENDPOINTS.playbooks.triggerMail(playbookId),
  );
  return response.data.data;
}

export async function syncPlaybookTriggerMailSubscription(
  playbookId: string,
  data: SyncPlaybookMailSubscriptionData,
): Promise<Record<string, unknown>> {
  const response = await apiClient.post<ApiResponse<Record<string, unknown>>>(
    API_ENDPOINTS.playbooks.triggerMail(playbookId) + '/sync-subscription',
    data,
  );
  return response.data.data;
}

export async function cloneSharePlaybook(
  id: string,
  emails: string[],
): Promise<CloneShareResult> {
  const response = await apiClient.post<ApiResponse<CloneShareResult>>(
    API_ENDPOINTS.playbooks.cloneShare(id),
    { emails },
  );
  return response.data.data;
}

export async function clonePlaybook(id: string): Promise<Playbook> {
  const response = await apiClient.post<ApiResponse<Playbook>>(
    API_ENDPOINTS.playbooks.clone(id),
  );
  return response.data.data;
}

export async function getPlaybookNodeTemplates(): Promise<{ items: Array<{
  id: string;
  key: string;
  type: string;
  title: string;
  description?: string;
  icon?: string;
  color?: string;
  category: string;
  inputPorts: Array<{ id: string; name: string; artifactKind: string; required?: boolean; description?: string }>;
  outputPorts: Array<{ id: string; name: string; artifactKind: string; description?: string }>;
  promptTemplate: string;
  recommendedAgentTypeSlug: string | null;
  requiredToolNames: string[];
  executionMode?: string;
  assignedAgentId?: string | null;
  selectedAction?: string | null;
}> }> {
  const response = await apiClient.get<ApiResponse<{ items: Array<{
    id: string;
    key: string;
    type: string;
    title: string;
    description?: string;
    icon?: string;
    color?: string;
    category: string;
    inputPorts: Array<{ id: string; name: string; artifactKind: string; required?: boolean; description?: string }>;
    outputPorts: Array<{ id: string; name: string; artifactKind: string; description?: string }>;
    promptTemplate: string;
    recommendedAgentTypeSlug: string | null;
    requiredToolNames: string[];
    executionMode?: string;
    assignedAgentId?: string | null;
    selectedAction?: string | null;
  }> }>>(
    API_ENDPOINTS.playbookNodeTemplates.list,
  );
  return response.data.data;
}

export async function deleteEvaluationBaseline(playbookId: string, taskId: string): Promise<{ removed: boolean }> {
  const response = await apiClient.delete<ApiResponse<{ removed: boolean }>>(
    API_ENDPOINTS.playbooks.evaluationBaseline(playbookId, taskId),
  );
  return response.data.data;
}

export async function getPlaybookRepeatability(
  playbookId: string,
  limit = 5,
): Promise<PlaybookRepeatabilitySummary> {
  const response = await apiClient.get<ApiResponse<PlaybookRepeatabilitySummary>>(
    API_ENDPOINTS.playbooks.repeatability(playbookId),
    { params: { limit } },
  );
  return response.data.data;
}

export async function getTaskRepeatability(
  playbookId: string,
  taskId: string,
  limit = 5,
): Promise<TaskRepeatabilityResult> {
  const response = await apiClient.get<ApiResponse<TaskRepeatabilityResult>>(
    API_ENDPOINTS.playbooks.repeatabilityTask(playbookId, taskId),
    { params: { limit } },
  );
  return response.data.data;
}

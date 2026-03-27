/**
 * Playbook API Functions
 */

import apiClient, { type ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type {
  Playbook,
  PlaybookSummary,
  PlaybookQueryParams,
  PlaybookExecution,
  PlaybookExecutionSummary,
  DesignMessage,
  CreatePlaybookData,
  GeneratePlaybookData,
  DesignPlaybookData,
  UpdatePlaybookData,
  ExecutePlaybookData,
  ResumePlaybookData,
  RerunStepData,
  CloneShareResult,
  ValidateTaskReplayData,
  ValidatedTaskReplay,
  UpdateTaskReplayFormatData,
  GrabOutputFormatTemplateData,
  UpdateOutputFormatTemplateData,
  OutputFormatTemplate,
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
    tasks: data.tasks.map(({
      hasValidatedReplay,
      activeReplayId,
      activeReplayVersion,
      activeReplayIsStale,
      activeReplayStaleReasons,
      activeReplayPreserveOutputFormat,
      activeReplayFormatGuideStatus,
      activeReplayFormatGuideError,
      hasOutputFormatTemplate,
      activeOutputFormatTemplateId,
      activeOutputFormatTemplateVersion,
      activeOutputFormatStatus,
      activeOutputFormatError,
      ...task
    }) => task),
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

export async function updatePlaybook(
  id: string,
  data: UpdatePlaybookData,
): Promise<Playbook> {
  const response = await apiClient.patch<ApiResponse<Playbook>>(
    API_ENDPOINTS.playbooks.byId(id),
    sanitizePlaybookUpdate(data),
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
  data: { taskId: string },
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

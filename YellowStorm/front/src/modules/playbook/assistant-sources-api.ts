import apiClient, { type ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';

/** A source question Yellowmind is waiting on while it designs a playbook, and what the person chose for it. */
export interface PlaybookSourceQuestion {
  id: string;
  question: string;
  reason: string;
  required: boolean;
  selector: 'workspace_or_document' | 'destination_workspace';
  /** The question's own answers ("SharePoint", "Workspace \"CV\""), besides choosing workspaces and files. */
  choices: string[];
  choice:
    | null
    | { skipped: true }
    | { skipped: false; option?: string; resources: Array<{ kind: 'workspace' | 'document'; name: string; workspaceName: string }> };
}

export interface PlaybookSourceQuestions {
  playbookName: string | null;
  questions: PlaybookSourceQuestion[];
}

export interface PlaybookSourceFile {
  id: string;
  name: string;
  mimeType: string;
  workspaceId: string;
  workspaceName: string;
  folderName: string | null;
}

export async function getPlaybookSourceQuestions(continuationId: string): Promise<PlaybookSourceQuestions> {
  const response = await apiClient.get<ApiResponse<PlaybookSourceQuestions>>(API_ENDPOINTS.playbooks.assistantClarificationSources(continuationId));
  return response.data.data;
}

export async function choosePlaybookSources(
  continuationId: string,
  questionId: string,
  choice: { resources: Array<{ kind: 'workspace' | 'document'; id: string }> } | { choice: string } | { skip: true },
): Promise<PlaybookSourceQuestions> {
  const response = await apiClient.put<ApiResponse<PlaybookSourceQuestions>>(
    API_ENDPOINTS.playbooks.assistantClarificationQuestionSources(continuationId, questionId),
    choice,
  );
  return response.data.data;
}

/** The Yellowmind clarifications on this playbook still waiting for sources. */
export async function getPendingPlaybookSources(playbookId: string): Promise<Array<{ continuationId: string; playbookName: string }>> {
  const response = await apiClient.get<ApiResponse<{ items: Array<{ continuationId: string; playbookName: string }> }>>(
    API_ENDPOINTS.playbooks.assistantPendingSources,
    { params: { playbookId } },
  );
  return response.data.data.items;
}

export async function searchPlaybookSourceFiles(search: string): Promise<{ files: PlaybookSourceFile[]; page: number; totalPages: number }> {
  const response = await apiClient.get<ApiResponse<{ files: PlaybookSourceFile[]; page: number; totalPages: number }>>(
    API_ENDPOINTS.playbooks.assistantSourceFiles,
    { params: { search } },
  );
  return response.data.data;
}

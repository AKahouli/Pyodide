import apiClient, { type ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type { DecisionFlowGenerationOptions, DecisionFlowPayload, WorkspaceArtifact } from './types';

export const listWorkspaceArtifacts = async (workspaceId: string): Promise<WorkspaceArtifact[]> => (await apiClient.get<ApiResponse<WorkspaceArtifact[]>>(API_ENDPOINTS.workspaceArtifacts.list(workspaceId))).data.data;
export const getWorkspaceArtifactConfiguration = async (workspaceId: string): Promise<{ configured: boolean }> => (await apiClient.get<ApiResponse<{ configured: boolean }>>(API_ENDPOINTS.workspaceArtifacts.configuration(workspaceId))).data.data;
export const getWorkspaceArtifact = async (workspaceId: string, artifactId: string): Promise<WorkspaceArtifact> => (await apiClient.get<ApiResponse<WorkspaceArtifact>>(API_ENDPOINTS.workspaceArtifacts.byId(workspaceId, artifactId))).data.data;
export const createDecisionFlowArtifact = async (workspaceId: string, input: { sourceDocumentId: string; name?: string; selectionMode: 'all' | 'pages'; pages?: number[]; generationOptions: DecisionFlowGenerationOptions }): Promise<WorkspaceArtifact> => (await apiClient.post<ApiResponse<WorkspaceArtifact>>(API_ENDPOINTS.workspaceArtifacts.decisionFlows(workspaceId), input)).data.data;
export const updateWorkspaceArtifact = async (workspaceId: string, artifactId: string, input: { expectedRevision: number; name?: string; description?: string; payload?: DecisionFlowPayload }): Promise<WorkspaceArtifact> => (await apiClient.patch<ApiResponse<WorkspaceArtifact>>(API_ENDPOINTS.workspaceArtifacts.byId(workspaceId, artifactId), input)).data.data;
export const cloneWorkspaceArtifact = async (workspaceId: string, artifactId: string): Promise<WorkspaceArtifact> => (await apiClient.post<ApiResponse<WorkspaceArtifact>>(API_ENDPOINTS.workspaceArtifacts.clone(workspaceId, artifactId))).data.data;
export const retryWorkspaceArtifact = async (workspaceId: string, artifactId: string): Promise<WorkspaceArtifact> => (await apiClient.post<ApiResponse<WorkspaceArtifact>>(API_ENDPOINTS.workspaceArtifacts.retry(workspaceId, artifactId))).data.data;
export const deleteWorkspaceArtifact = async (workspaceId: string, artifactId: string): Promise<void> => { await apiClient.delete(API_ENDPOINTS.workspaceArtifacts.byId(workspaceId, artifactId)); };

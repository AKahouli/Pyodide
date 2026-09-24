import { apiClient } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type { LogicalSearchEvaluation, UploadResult, PrepareResult, AdhocConfig } from './types';

export interface EvaluationRunResult {
  status: 'prepared' | 'running' | 'completed' | 'failed';
}

export interface EvaluationProgressResult {
  evaluationId: string;
  status: 'prepared' | 'running' | 'completed' | 'failed';
  progress: {
    done: number;
    total: number;
    currentIndex: number;
    currentQueryId: string;
    currentQuery: string;
    updatedAt: string;
  } | null;
}

export interface EvaluationExportResult {
  blob: Blob;
  filename: string;
}

function parseFilenameFromContentDisposition(header?: string): string | null {
  if (!header) return null;
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      // fall through to ascii
    }
  }
  const asciiMatch = header.match(/filename="?([^";]+)"?/i);
  return asciiMatch?.[1] ?? null;
}

export const evaluationLogicalSearchApi = {
  async upload(file: File): Promise<UploadResult> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await apiClient.post<{ data: UploadResult }>(
      `${API_ENDPOINTS.logicalSearchEvaluation.base}/upload`,
      formData,
    );
    return res.data.data;
  },

  async list(): Promise<LogicalSearchEvaluation[]> {
    const res = await apiClient.get<{ data: LogicalSearchEvaluation[] }>(
      API_ENDPOINTS.logicalSearchEvaluation.base,
      { timeout: 180000 },
    );
    return res.data.data;
  },

  async getById(id: string): Promise<LogicalSearchEvaluation> {
    const res = await apiClient.get<{ data: LogicalSearchEvaluation }>(
      `${API_ENDPOINTS.logicalSearchEvaluation.base}/${id}`,
    );
    return res.data.data;
  },

  async duplicate(id: string): Promise<{ evaluationId: string }> {
    const res = await apiClient.post<{ data: { evaluationId: string } }>(
      `${API_ENDPOINTS.logicalSearchEvaluation.base}/${id}/duplicate`,
    );
    return res.data.data;
  },

  async prepare(
    id: string,
    payload: { executionId: string; agentId?: string; workspaceId?: string },
  ): Promise<PrepareResult> {
    const res = await apiClient.post<{ data: PrepareResult }>(
      `${API_ENDPOINTS.logicalSearchEvaluation.base}/${id}/prepare`,
      payload,
    );
    return res.data.data;
  },

  async prepareAdhoc(id: string, config: AdhocConfig): Promise<PrepareResult> {
    const res = await apiClient.post<{ data: PrepareResult }>(
      `${API_ENDPOINTS.logicalSearchEvaluation.base}/${id}/prepare-adhoc`,
      config,
    );
    return res.data.data;
  },

  async run(id: string, queryId?: string): Promise<EvaluationRunResult> {
    const res = await apiClient.post<{ data: EvaluationRunResult }>(
      `${API_ENDPOINTS.logicalSearchEvaluation.base}/${id}/run`,
      queryId ? { queryId } : {},
    );
    return res.data.data;
  },

  async stop(id: string): Promise<EvaluationRunResult> {
    const res = await apiClient.post<{ data: EvaluationRunResult }>(
      `${API_ENDPOINTS.logicalSearchEvaluation.base}/${id}/stop`,
    );
    return res.data.data;
  },

  async progress(id: string): Promise<EvaluationProgressResult> {
    const res = await apiClient.get<{ data: EvaluationProgressResult }>(
      `${API_ENDPOINTS.logicalSearchEvaluation.base}/${id}/progress`,
    );
    return res.data.data;
  },

  async exportResults(id: string): Promise<EvaluationExportResult> {
    const res = await apiClient.get<Blob>(`${API_ENDPOINTS.logicalSearchEvaluation.base}/${id}/export`, {
      responseType: 'blob',
    });
    const disposition = res.headers?.['content-disposition'] as string | undefined;
    const filename = parseFilenameFromContentDisposition(disposition) ?? `evaluation_export_${id}.zip`;
    return { blob: res.data, filename };
  },
};

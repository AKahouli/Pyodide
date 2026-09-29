import { apiClient } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type { LogicalSearchEvaluation, UploadResult, PrepareResult, AdhocConfig, EvaluationResultsResponse, EvaluationReportResponse } from './types';

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
  async upload(file: File, onProgress?: (percent: number) => void): Promise<UploadResult> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await apiClient.post<{ data: UploadResult }>(
      `${API_ENDPOINTS.logicalSearchEvaluation.base}/upload`,
      formData,
      {
        onUploadProgress: onProgress
          ? (event) => {
              if (event.total) onProgress(Math.round((event.loaded / event.total) * 100));
            }
          : undefined,
      },
    );
    return res.data.data;
  },

  async list(params?: { limit?: number; offset?: number; scope?: 'runs' | 'benchmarks' }): Promise<{ items: LogicalSearchEvaluation[]; total: number }> {
    const res = await apiClient.get<{ data: { items: LogicalSearchEvaluation[]; total: number } }>(
      API_ENDPOINTS.logicalSearchEvaluation.base,
      { params, timeout: 180000 },
    );
    return res.data.data;
  },

  async remove(id: string): Promise<void> {
    await apiClient.delete(`${API_ENDPOINTS.logicalSearchEvaluation.base}/${id}`);
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

  async prepareAdhoc(id: string, config: AdhocConfig): Promise<PrepareResult> {
    const res = await apiClient.post<{ data: PrepareResult }>(
      `${API_ENDPOINTS.logicalSearchEvaluation.base}/${id}/prepare-adhoc`,
      config,
    );
    return res.data.data;
  },

  async run(id: string, queryIds?: string[]): Promise<EvaluationRunResult> {
    const res = await apiClient.post<{ data: EvaluationRunResult }>(
      `${API_ENDPOINTS.logicalSearchEvaluation.base}/${id}/run`,
      queryIds && queryIds.length > 0 ? { queryIds } : {},
      // The run request stays open for the whole evaluation; the default 30s
      // client timeout would abort long benchmarks and mark them failed.
      { timeout: 1800000 },
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

  async results(id: string): Promise<EvaluationResultsResponse> {
    const res = await apiClient.get<{ data: EvaluationResultsResponse }>(
      `${API_ENDPOINTS.logicalSearchEvaluation.base}/${id}/results`,
      { timeout: 180000 },
    );
    return res.data.data;
  },

  async getReport(id: string): Promise<EvaluationReportResponse> {
    const res = await apiClient.get<{ data: EvaluationReportResponse }>(
      `${API_ENDPOINTS.logicalSearchEvaluation.base}/${id}/report`,
    );
    return res.data.data;
  },

  async generateReport(id: string, agentId: string, locale?: string): Promise<EvaluationReportResponse> {
    const res = await apiClient.post<{ data: EvaluationReportResponse }>(
      `${API_ENDPOINTS.logicalSearchEvaluation.base}/${id}/report`,
      { agentId, locale },
      { timeout: 300000 },
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

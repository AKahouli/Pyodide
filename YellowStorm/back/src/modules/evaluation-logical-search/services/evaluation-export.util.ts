import AdmZip = require('adm-zip');
import type { EvaluationQueryResult } from './evaluation-metrics';

/**
 * Excel hard limit is 32,767 characters per cell. Stay under it with margin so
 * a long execution log never corrupts the workbook; the untruncated value is
 * always available in the companion JSON file of the export archive.
 */
export const MAX_EXCEL_CELL_LENGTH = 32_000;
const EXCEL_TRUNCATION_MARKER = ' … [truncated — full value in the JSON export]';

export function truncateForExcelCell(value: string): string {
  if (value.length <= MAX_EXCEL_CELL_LENGTH) {
    return value;
  }
  return value.slice(0, MAX_EXCEL_CELL_LENGTH - EXCEL_TRUNCATION_MARKER.length) + EXCEL_TRUNCATION_MARKER;
}

export function truncateExportRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === 'string' ? truncateForExcelCell(value) : value,
    ]),
  );
}

export interface EvaluationExecutionLogsExport {
  evaluationId: string;
  exportedAt: string;
  queries: Array<{
    queryId: string;
    status: string;
    error: string | null;
    tokenUsage: EvaluationQueryResult['token_usage'] | null;
    targetTokenUsage: EvaluationQueryResult['target_token_usage'] | null;
    judgeTokenUsage: EvaluationQueryResult['judge_token_usage'] | null;
    toolCalls: NonNullable<EvaluationQueryResult['tool_calls']>;
  }>;
}

const MAX_PARSE_DEPTH = 8;

/**
 * Tool outputs are captured as raw strings that frequently wrap another JSON
 * payload (e.g. `{"text": "[{...}]"}`), which makes the export unreadable. Decode
 * nested JSON strings into structured objects so the pretty-printed export shows
 * real fields instead of escaped text. Base64 image parts are collapsed to a
 * short descriptor so the file stays readable.
 */
export function parseToolOutput(value: unknown, depth = 0): unknown {
  if (depth > MAX_PARSE_DEPTH) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return parseToolOutput(JSON.parse(trimmed), depth + 1);
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => parseToolOutput(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const mimeType = typeof record.mimeType === 'string' ? record.mimeType : undefined;
    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [
        key,
        key === 'data' && mimeType && typeof entry === 'string'
          ? `<base64 ${mimeType}, ${entry.length} chars omitted>`
          : parseToolOutput(entry, depth + 1),
      ]),
    );
  }
  return value;
}

export function buildExecutionLogsExport(
  evaluationId: string,
  results: EvaluationQueryResult[],
  exportedAt: string = new Date().toISOString(),
): EvaluationExecutionLogsExport {
  return {
    evaluationId,
    exportedAt,
    queries: results.map((result) => ({
      queryId: result.query_id,
      status: result.status,
      error: result.error ?? null,
      tokenUsage: result.token_usage ?? null,
      targetTokenUsage: result.target_token_usage ?? null,
      judgeTokenUsage: result.judge_token_usage ?? null,
      toolCalls: (result.tool_calls ?? []).map((call) => ({
        ...call,
        args: parseToolOutput(call.args),
        output_summary: parseToolOutput(call.output_summary),
      })),
    })),
  };
}

export function buildExportArchive(params: {
  evaluationId: string;
  xlsx: Buffer;
  logsJson: string;
}): Buffer {
  const baseName = `logical_search_evaluation_${params.evaluationId}`;
  const zip = new AdmZip();
  zip.addFile(`${baseName}.xlsx`, params.xlsx);
  zip.addFile(`${baseName}_execution_logs.json`, Buffer.from(params.logsJson, 'utf8'));
  return zip.toBuffer();
}

export function buildExportFilename(date: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp =
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
  return `evaluation_export_${stamp}.zip`;
}

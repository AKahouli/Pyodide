import AdmZip = require('adm-zip');
import {
  buildExecutionLogsExport,
  buildExportArchive,
  buildExportFilename,
  MAX_EXCEL_CELL_LENGTH,
  parseToolOutput,
  truncateForExcelCell,
  truncateExportRow,
} from './evaluation-export.util';

describe('evaluation export util', () => {
  describe('truncateForExcelCell', () => {
    it('keeps short values untouched', () => {
      expect(truncateForExcelCell('short value')).toBe('short value');
    });

    it('truncates long values under the Excel cell limit with a marker', () => {
      const long = 'x'.repeat(MAX_EXCEL_CELL_LENGTH + 500);
      const result = truncateForExcelCell(long);

      expect(result.length).toBeLessThanOrEqual(MAX_EXCEL_CELL_LENGTH);
      expect(result.length).toBeLessThan(32_767);
      expect(result).toContain('[truncated');
    });
  });

  it('truncates every string cell of a row but keeps numbers intact', () => {
    const row = truncateExportRow({
      'Query ID': 'Q1',
      'Execution Logs / Tool Calls': 'y'.repeat(MAX_EXCEL_CELL_LENGTH + 1),
      'Duration (ms)': 1234,
    });

    expect(row['Query ID']).toBe('Q1');
    expect((row['Execution Logs / Tool Calls'] as string).length).toBeLessThanOrEqual(MAX_EXCEL_CELL_LENGTH);
    expect(row['Duration (ms)']).toBe(1234);
  });

  it('keeps the full untruncated tool calls in the JSON payload', () => {
    const fullOutput = 'z'.repeat(MAX_EXCEL_CELL_LENGTH + 10_000);
    const results = [
      {
        query_id: 'Q42',
        status: 'completed',
        error: null,
        token_usage: { total_tokens: 10 },
        tool_calls: [{ tool_name: 'search', output_summary: fullOutput }],
      },
    ];

    const payload = buildExecutionLogsExport('eval-1', results as never, '2026-01-01T00:00:00.000Z');

    expect(payload.queries[0].queryId).toBe('Q42');
    expect(payload.queries[0].toolCalls[0].output_summary).toHaveLength(fullOutput.length);
  });

  describe('parseToolOutput', () => {
    it('decodes a JSON string wrapped in a text field into structured data', () => {
      const raw = JSON.stringify({ text: JSON.stringify([{ section_id: 28616, block_ids: [1, 2] }]) });

      const parsed = parseToolOutput(raw) as { text: Array<{ section_id: number }> };

      expect(Array.isArray(parsed.text)).toBe(true);
      expect(parsed.text[0].section_id).toBe(28616);
    });

    it('decodes JSON strings nested in args', () => {
      const parsed = parseToolOutput({ section_id: '["74216", "73978"]' }) as { section_id: string[] };

      expect(parsed.section_id).toEqual(['74216', '73978']);
    });

    it('leaves non-JSON text untouched and collapses base64 image parts', () => {
      expect(parseToolOutput('plain evidence text')).toBe('plain evidence text');

      const part = parseToolOutput({ mimeType: 'image/jpeg', data: 'A'.repeat(2048) }) as { data: string };
      expect(part.data).toBe('<base64 image/jpeg, 2048 chars omitted>');
    });
  });

  it('packages the xlsx and the raw logs json in a single zip', () => {
    const xlsx = Buffer.from('xlsx-bytes');
    const logsJson = JSON.stringify({ evaluationId: 'eval-1', queries: [] });
    const archive = buildExportArchive({ evaluationId: 'eval-1', xlsx, logsJson });

    const zip = new AdmZip(archive);
    const names = zip.getEntries().map((entry) => entry.entryName).sort();

    expect(names).toEqual([
      'logical_search_evaluation_eval-1.xlsx',
      'logical_search_evaluation_eval-1_execution_logs.json',
    ]);
    expect(zip.readAsText('logical_search_evaluation_eval-1_execution_logs.json')).toBe(logsJson);
  });

  it('builds a timestamped archive filename', () => {
    const name = buildExportFilename(new Date('2026-09-23T14:05:06.000Z'));
    expect(name).toBe('evaluation_export_20260923-140506.zip');
  });
});

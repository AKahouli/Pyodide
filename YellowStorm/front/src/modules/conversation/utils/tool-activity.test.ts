import { describe, expect, it } from 'vitest';
import {
  formatSanitizedToolText,
  isCodeInterpreterActivity,
  resolveCodeInterpreterRequest,
  resolveCodeInterpreterResponse,
  resolveToolRequest,
  resolveToolResponse,
  resolveToolDisplayKey,
  resolveToolRenderKind,
  resolveToolSummary,
  sanitizeRunCodeInput,
} from './tool-activity';

// Display-time redaction was removed: payloads render exactly as stored, with
// only the size guards (truncation) still applied.
describe('formatSanitizedToolText', () => {
  it('renders payloads verbatim, including paths, credentials, and sentinel noise', () => {
    const output = formatSanitizedToolText(JSON.stringify({
      password: 'private',
      path: '/workspace/run/file.txt',
      signedUrl: 'https://storage.example/private/report?X-Amz-Credential=private-scope&X-Amz-Signature=private-signature',
      result: 'VNC: ws://sandbox.internal/session/abc123\nCDP: http://sandbox.internal/session/abc123',
    }));

    expect(output).toContain('"password": "private"');
    expect(output).toContain('/workspace/run/file.txt');
    expect(output).toContain('X-Amz-Signature=private-signature');
    expect(output).toContain('ws://sandbox.internal/session/abc123');
  });

  it('returns run-code input verbatim', () => {
    expect(sanitizeRunCodeInput("password='private'; print('/workspace/report.pdf')")).toBe("password='private'; print('/workspace/report.pdf')");
    expect(sanitizeRunCodeInput('   ')).toBeUndefined();
  });

  it('keeps nested objects, identifiers, and code as stored', () => {
    const output = formatSanitizedToolText(JSON.stringify({
      status: 'failed',
      detail: { message: 'Execution stopped', stackTrace: 'at /workspace/private.py:1' },
      artifactId: '507f1f77bcf86cd799439011',
      url: 's3://private-bucket/result.json',
      code: 'print("private")',
    }));

    expect(output).toContain('Execution stopped');
    expect(output).toContain('/workspace/private.py:1');
    expect(output).toContain('507f1f77bcf86cd799439011');
    expect(output).toContain('s3://private-bucket/result.json');
    expect(output).toContain('print(');
  });

  it('returns plain-text responses as-is', () => {
    expect(formatSanitizedToolText('file=/tmp/private/result.txt')).toBe('file=/tmp/private/result.txt');
  });

  it('bounds formatted and oversized serialized payloads before rendering', () => {
    const formatted = formatSanitizedToolText(JSON.stringify({
      rows: Array.from({ length: 100 }, (_, index) => ({ index, values: Array.from({ length: 30 }, (_, value) => value) })),
    }));
    const oversized = formatSanitizedToolText(JSON.stringify({ result: 'x'.repeat(70_000) }));

    expect(formatted).toContain('[truncated]');
    expect(formatted!.length).toBeLessThanOrEqual(12_000);
    expect(oversized).toBe('[truncated]');
  });
});

describe('code interpreter activity details', () => {
  it('preserves executable requests and output as stored', () => {
    const data = {
      toolName: 'code_interpreter_shell_exec',
      renderKind: 'run_code',
      paramsJson: JSON.stringify({ command: 'pandoc source.md -o output.pdf', apiKey: 'private' }),
      resultJson: JSON.stringify({ stdout: 'Created output.pdf', exit_code: 0, workspacePath: '/workspace/private/output.pdf' }),
    };

    expect(isCodeInterpreterActivity(data)).toBe(true);
    expect(resolveCodeInterpreterRequest(data)).toBe('pandoc source.md -o output.pdf');
    expect(resolveCodeInterpreterResponse(data)).toContain('Created output.pdf');
    expect(resolveCodeInterpreterResponse(data)).toContain('"exit_code": 0');
    expect(resolveCodeInterpreterResponse(data)).toContain('/workspace/private/output.pdf');
  });

  it('uses run-code primary input before serialized parameters', () => {
    expect(resolveCodeInterpreterRequest({
      toolName: 'run_code',
      primaryInput: 'print("hello")',
      paramsJson: JSON.stringify({ code: 'print("other")' }),
    })).toBe('print("hello")');
  });

  it('bounds oversized serialized and object requests before full rendering', () => {
    const serialized = resolveCodeInterpreterRequest({
      toolName: 'python_interpreter',
      paramsJson: JSON.stringify({ code: 'x'.repeat(70_000) }),
    });
    const object = resolveCodeInterpreterRequest({
      toolName: 'python_interpreter',
      params: { rows: Array.from({ length: 10_000 }, (_, index) => ({ index })) },
    });

    expect(serialized).toBe('[truncated]');
    expect(object!.length).toBeLessThanOrEqual(12_000);
    expect(object).toContain('[truncated]');
  });
});

describe('generic tool activity details', () => {
  it('renders serialized requests and responses as stored', () => {
    const data = {
      toolName: 'perform_standard_search',
      paramsJson: JSON.stringify({ query: 'annual revenue', password: 'private' }),
      resultJson: JSON.stringify({ matches: 4, path: '/workspace/private/result.json' }),
    };

    expect(resolveToolRequest(data)).toContain('annual revenue');
    expect(resolveToolRequest(data)).toContain('private');
    expect(resolveToolResponse(data)).toContain('"matches": 4');
    expect(resolveToolResponse(data)).toContain('/workspace/private/result.json');
  });
});

describe('resolveToolSummary', () => {
  it('uses only the authoritative dynamic summary', () => {
    expect(resolveToolSummary({
      summary: 'Find the requested revenue evidence',
      description: 'ignored description',
      paramsJson: JSON.stringify({ query: 'ignored query' }),
    })).toBe('Find the requested revenue evidence');
  });

  it.each([
    { toolName: 'run_code', description: 'fallback description', paramsJson: JSON.stringify({ description: 'argument description' }) },
    { toolName: 'perform_document_search', paramsJson: JSON.stringify({ query: 'quarterly revenue' }) },
    { toolName: 'find_file', paramsJson: JSON.stringify({ pattern: '*.pdf' }) },
    { toolName: 'read_file', paramsJson: JSON.stringify({ path: '/workspace/private/report.pdf' }) },
  ])('does not reconstruct a missing summary from tool arguments', (data) => {
    expect(resolveToolSummary({ ...data, summary: '' })).toBeUndefined();
  });
});

describe('resolveToolDisplayKey', () => {
  it.each([
    ['code-interpreter_file_list', 'findFiles'],
    ['code-interpreter_file_find', 'findFiles'],
    ['code-interpreter_shell_exec', 'runCommand'],
    ['pyodide_execute_python', 'runCode'],
  ])('maps %s to %s for mixed-version activities', (toolName, displayKey) => {
    expect(resolveToolDisplayKey({ toolName })).toBe(displayKey);
  });

  it('renders the browser Python MCP tool as a code execution', () => {
    expect(resolveToolRenderKind('pyodide_execute_python')).toBe('run_code');
  });
});

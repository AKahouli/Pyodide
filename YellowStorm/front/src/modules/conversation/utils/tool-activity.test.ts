import { describe, expect, it } from 'vitest';
import {
  formatSanitizedToolText,
  isCodeInterpreterActivity,
  resolveCodeInterpreterRequest,
  resolveCodeInterpreterResponse,
  resolveToolRequest,
  resolveToolResponse,
  resolveToolDisplayKey,
  resolveToolSummary,
  sanitizeRunCodeInput,
} from './tool-activity';

describe('formatSanitizedToolText', () => {
  it('preserves paths and endpoints but always removes credentials when display redaction is disabled', () => {
    const output = formatSanitizedToolText(JSON.stringify({
      password: 'private',
      path: '/workspace/run/file.txt',
      signedUrl: 'https://storage.example/private/report?X-Amz-Credential=private-scope&X-Amz-Signature=private-signature',
      result: 'VNC: ws://sandbox.internal/session/abc123\nCDP: http://sandbox.internal/session/abc123',
      message: 'Cookie: session=private YELLOWSTORM_ATTACHMENT_SENTINEL_42',
    }), false);

    expect(output).toContain('"password": "[REDACTED]"');
    expect(output).toContain('ws://sandbox.internal/session/abc123');
    expect(output).toContain('http://sandbox.internal/session/abc123');
    expect(output).toContain('https://storage.example/private/report?X-Amz-Credential=[REDACTED]&X-Amz-Signature=[REDACTED]');
    expect(output).not.toContain('private-signature');
    expect(output).not.toContain('session=private');
    expect(output).not.toContain('YELLOWSTORM_ATTACHMENT_SENTINEL');
  });

  it('keeps code paths but removes credentials from run-code input when display redaction is disabled', () => {
    const input = sanitizeRunCodeInput("password='private'; print('/workspace/report.pdf')", false);

    expect(input).toContain('/workspace/report.pdf');
    expect(input).not.toContain('private');
    expect(input).toContain('password=[REDACTED]');
  });
  it('keeps useful output while redacting nested private fields and unsafe strings', () => {
    const output = formatSanitizedToolText(JSON.stringify({
      status: 'failed',
      detail: { message: 'Execution stopped', stackTrace: 'at /workspace/private.py:1' },
      artifactId: '507f1f77bcf86cd799439011',
      url: 's3://private-bucket/result.json',
      code: 'print("private")',
    }));

    expect(output).toContain('Execution stopped');
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('/workspace');
    expect(output).not.toContain('507f1f77bcf86cd799439011');
    expect(output).not.toContain('s3://');
    expect(output).not.toContain('print(');
  });

  it('redacts unsafe plain-text responses', () => {
    expect(formatSanitizedToolText('file=/tmp/private/result.txt')).toBe('[REDACTED]');
  });

  it('redacts credential and URI values regardless of their field name', () => {
    const credentialOutput = formatSanitizedToolText(JSON.stringify({ credentialBundle: 'AIzaSyExampleCredentialValue123456789' }));
    const uriOutput = formatSanitizedToolText(JSON.stringify({ download: 'https://storage.example/result?signature=private' }));
    expect(credentialOutput).toContain('[REDACTED]');
    expect(credentialOutput).not.toContain('AIzaSyExampleCredentialValue123456789');
    expect(uriOutput).toContain('[REDACTED]');
    expect(uriOutput).not.toContain('storage.example');
  });

  it('redacts source code stored in an otherwise allowed output field', () => {
    const output = formatSanitizedToolText(JSON.stringify({ stdout: "console.error('proprietary logic')" }));

    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('proprietary logic');
  });

  it('redacts source-bearing fields regardless of code syntax', () => {
    const output = formatSanitizedToolText(JSON.stringify({ code: 'return userInput', sourceCode: 'yield record', script: 'exit 1' }));

    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain('return userInput');
    expect(output).not.toContain('yield record');
    expect(output).not.toContain('exit 1');
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
  it('preserves executable requests and output while redacting private metadata', () => {
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
    expect(resolveCodeInterpreterResponse(data)).not.toContain('/workspace/private');
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

  it('redacts arbitrary paths and environment credentials in requests and output', () => {
    const request = resolveCodeInterpreterRequest({
      toolName: 'code_interpreter_shell_exec',
      paramsJson: JSON.stringify({ command: 'cat /etc/yellowstorm/config' }),
    });
    const response = resolveCodeInterpreterResponse({
      toolName: 'code_interpreter_shell_exec',
      resultJson: JSON.stringify({ stdout: 'DB_PASSWORD=short-value', file: 'owner/system_run/private.txt' }),
    });

    expect(request).toBe('cat [REDACTED]');
    expect(response).not.toContain('/etc/yellowstorm');
    expect(response).not.toContain('short-value');
    expect(response).not.toContain('owner/system_run');
  });
});

describe('generic tool activity details', () => {
  it('sanitizes serialized requests and responses', () => {
    const data = {
      toolName: 'perform_standard_search',
      paramsJson: JSON.stringify({ query: 'annual revenue', password: 'private' }),
      resultJson: JSON.stringify({ matches: 4, path: '/workspace/private/result.json' }),
    };

    expect(resolveToolRequest(data)).toContain('annual revenue');
    expect(resolveToolRequest(data)).not.toContain('private');
    expect(resolveToolResponse(data)).toContain('"matches": 4');
    expect(resolveToolResponse(data)).not.toContain('/workspace/private');
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
  ])('maps %s to %s for mixed-version activities', (toolName, displayKey) => {
    expect(resolveToolDisplayKey({ toolName })).toBe(displayKey);
  });
});

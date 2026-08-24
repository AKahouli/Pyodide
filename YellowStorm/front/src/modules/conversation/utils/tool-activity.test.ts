import { describe, expect, it } from 'vitest';
import { formatSanitizedToolText, isCodeInterpreterActivity, resolveCodeInterpreterRequest, resolveCodeInterpreterResponse } from './tool-activity';

describe('formatSanitizedToolText', () => {
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

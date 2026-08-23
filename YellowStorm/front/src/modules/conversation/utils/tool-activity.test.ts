import { describe, expect, it } from 'vitest';
import { formatSanitizedToolText } from './tool-activity';

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

import { sanitizePublicComponent, sanitizePublicToolData } from './public-component-sanitizer';

describe('public component sanitizer', () => {
  it('recursively redacts sensitive keys and bearer credentials', () => {
    expect(sanitizePublicToolData({
      authorization: 'Bearer secret-token',
      nested: { apiKey: 'private', query: 'safe' },
      env: { DB_PASSWORD: 'structured-secret', SERVICE_API_KEY: 'structured-key' },
      message: 'Authorization: Bearer abc.def',
    })).toEqual({
      authorization: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', query: 'safe' },
      env: { DB_PASSWORD: '[REDACTED]', SERVICE_API_KEY: '[REDACTED]' },
      message: 'Authorization: [REDACTED]',
    });
  });

  it('sanitizes JSON-encoded tool parameters and results', () => {
    const component = sanitizePublicComponent({
      id: 'tool-1',
      type: 'toolActivity',
      data: {
        paramsJson: '{"query":"safe","password":"private"}',
        resultJson: '{"access_token":"token","count":2}',
      },
    });

    expect(component.data).toEqual({
      paramsJson: '{"query":"safe","password":"[REDACTED]"}',
      resultJson: '{"access_token":"[REDACTED]","count":2}',
    });
  });

  it('redacts arbitrary paths and environment-style credentials', () => {
    const component = sanitizePublicComponent({
      id: 'tool-2',
      type: 'toolActivity',
      data: {
        paramsJson: '{"command":"cat /etc/yellowstorm/config"}',
        resultJson: '{"stdout":"DB_PASSWORD=short-value","ceph_path":"owner/system_run/private.pdf"}',
      },
    });

    expect(component.data.paramsJson).not.toContain('/etc/yellowstorm');
    expect(component.data.resultJson).not.toContain('short-value');
    expect(component.data.resultJson).not.toContain('owner/system_run');
  });

  it('removes attachment sentinels from answer text without redacting or bounding it', () => {
    const longAnalysis = 'Analyse complète. '.repeat(1400);
    const component = sanitizePublicComponent({
      id: 'text-1',
      type: 'text',
      data: {
        content: `Before {"content":"YELLOWSTORM_ATTACHMENT_SENTINEL_123\\n"} /workspace/sources/id/report.pdf after ${longAnalysis}`,
      },
    });

    expect(component.data.content).not.toContain('YELLOWSTORM_ATTACHMENT_SENTINEL');
    expect(component.data.content).toContain('/workspace/sources/id/report.pdf');
    expect(component.data.content).toBe(
      `Before  /workspace/sources/id/report.pdf after ${longAnalysis}`,
    );
    expect((component.data.content as string).length).toBeGreaterThan(20_000);
  });

  it('does not classify numeric slash dates as storage paths', () => {
    const component = sanitizePublicComponent({
      id: 'text-date',
      type: 'text',
      data: { content: 'Cover pool au 30/06/2025 — 19 931,3 M€' },
    });

    expect(component.data.content).toBe('Cover pool au 30/06/2025 — 19 931,3 M€');
  });

  it('passes answer text through unchanged regardless of path-like fragments', () => {
    const component = sanitizePublicComponent({
      id: 'text-numeric-path',
      type: 'text',
      data: { content: 'Invalid 31/02/2025 paths 123/456/789, 1/2/2025, 0001/02/2025, 2025/2/1, 2025/02/0001' },
    });

    expect(component.data.content).toBe(
      'Invalid 31/02/2025 paths 123/456/789, 1/2/2025, 0001/02/2025, 2025/2/1, 2025/02/0001',
    );
  });

  it('still bounds oversized diagnostic payload strings', () => {
    const component = sanitizePublicComponent({
      id: 'tool-big',
      type: 'toolActivity',
      data: { paramsJson: `{"stdout":"${'x'.repeat(25_000)}"}` },
    });

    const paramsJson = component.data.paramsJson as string;
    expect(paramsJson).toContain('... [truncated]');
    expect(paramsJson.length).toBeLessThan(21_000);
  });

  it('still redacts non-content fields of text components', () => {
    const component = sanitizePublicComponent({
      id: 'text-extra',
      type: 'text',
      data: { content: 'Answer body', paramsJson: '{"password":"private"}' },
    });

    expect(component.data.content).toBe('Answer body');
    expect(component.data.paramsJson).toBe('{"password":"[REDACTED]"}');
  });

  it('routes text components with non-string content through full sanitization', () => {
    const component = sanitizePublicComponent({
      id: 'text-nonstring',
      type: 'text',
      data: { content: { password: 'private' } },
    });

    expect(component.data).toEqual({ content: { password: '[REDACTED]' } });
  });

  it('never exposes artifact storage paths', () => {
    const component = sanitizePublicComponent({
      id: 'artifact-1',
      type: 'artifact',
      data: { artifactId: 'opaque', filename: 'report.pdf', storagePath: '/workspace/run/report.pdf' },
    });

    expect(component.data).toEqual({ artifactId: 'opaque', filename: 'report.pdf' });
  });

  it('preserves paths but always removes credentials when display redaction is disabled', () => {
    const component = sanitizePublicComponent({
      id: 'tool-3',
      type: 'toolActivity',
      data: {
        paramsJson: '{"command":"cat /etc/yellowstorm/config","password":"private","message":"Cookie: session=private YELLOWSTORM_ATTACHMENT_SENTINEL_42"}',
        resultJson: '{"result":"VNC: ws://sandbox.internal/session/abc123\\nCDP: http://sandbox.internal/session/abc123\\nFile: https://storage.example/private/report?X-Amz-Credential=private-scope&X-Amz-Signature=private-signature"}',
      },
    }, { redactSensitiveText: false });

    expect(component.data.paramsJson).toContain('/etc/yellowstorm/config');
    expect(component.data.paramsJson).toContain('"password":"[REDACTED]"');
    expect(component.data.paramsJson).not.toContain('session=private');
    expect(component.data.paramsJson).not.toContain('YELLOWSTORM_ATTACHMENT_SENTINEL');
    expect(component.data.resultJson).toContain('ws://sandbox.internal/session/abc123');
    expect(component.data.resultJson).toContain('http://sandbox.internal/session/abc123');
    expect(component.data.resultJson).toContain('X-Amz-Credential=[REDACTED]&X-Amz-Signature=[REDACTED]');
    expect(component.data.resultJson).not.toContain('private-signature');
  });

  it('keeps hard-omitted artifact paths private when display redaction is disabled', () => {
    const component = sanitizePublicComponent({
      id: 'artifact-2',
      type: 'artifact',
      data: { artifactId: 'opaque', filename: 'report.pdf', storagePath: '/workspace/run/report.pdf' },
    }, { redactSensitiveText: false });

    expect(component.data).toEqual({ artifactId: 'opaque', filename: 'report.pdf' });
  });

  it('preserves full agent detail only for authenticated conversation responses', () => {
    const activity = {
      id: 'activity-1',
      type: 'agentActivity' as const,
      data: { summary: 'Inspecting reports', detail: 'Private reasoning with /workspace/source.pdf', status: 'completed' },
    };

    expect(sanitizePublicComponent(activity).data).not.toHaveProperty('detail');
    expect(sanitizePublicComponent(activity, { includeAgentDetail: true }).data.detail)
      .toBe('Private reasoning with /workspace/source.pdf');
  });
});

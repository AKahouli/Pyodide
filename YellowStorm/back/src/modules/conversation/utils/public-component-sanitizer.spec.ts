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

  it('removes attachment sentinels and redacts workspace paths from answer text', () => {
    const component = sanitizePublicComponent({
      id: 'text-1',
      type: 'text',
      data: { content: 'Before {"content":"YELLOWSTORM_ATTACHMENT_SENTINEL_123\\n"} /workspace/sources/id/report.pdf after' },
    });

    expect(component.data.content).toBe('Before  [REDACTED] after');
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

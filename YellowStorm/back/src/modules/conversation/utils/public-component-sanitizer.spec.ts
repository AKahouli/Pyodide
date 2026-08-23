import { sanitizePublicComponent, sanitizePublicToolData } from './public-component-sanitizer';

describe('public component sanitizer', () => {
  it('recursively redacts sensitive keys and bearer credentials', () => {
    expect(sanitizePublicToolData({
      authorization: 'Bearer secret-token',
      nested: { apiKey: 'private', query: 'safe' },
      message: 'Authorization: Bearer abc.def',
    })).toEqual({
      authorization: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', query: 'safe' },
      message: 'Authorization: Bearer [REDACTED]',
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
});

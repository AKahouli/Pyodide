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
      type: 'toolInfo',
      data: {
        params: '{"query":"safe","password":"private"}',
        resultJson: '{"access_token":"token","count":2}',
      },
    });

    expect(component.data).toEqual({
      params: '{"query":"safe","password":"[REDACTED]"}',
      resultJson: '{"access_token":"[REDACTED]","count":2}',
    });
  });
});

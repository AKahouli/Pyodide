import { createHash } from 'crypto';
import { redactUrlForLog, redactUrlsInMessage } from './redact-url';

describe('redactUrlForLog', () => {
  it('keeps scheme and host, hashes path, and drops query/fragment', () => {
    const result = redactUrlForLog(
      'https://contoso.sharepoint.com/sites/hr/_layouts/download.aspx?token=secret-sas&sig=abc#frag',
    );

    expect(result).toEqual({
      scheme: 'https',
      host: 'contoso.sharepoint.com',
      pathHash: createHash('sha256')
        .update('/sites/hr/_layouts/download.aspx')
        .digest('hex')
        .slice(0, 12),
    });
    expect(JSON.stringify(result)).not.toContain('secret-sas');
    expect(JSON.stringify(result)).not.toContain('sig=');
    expect(JSON.stringify(result)).not.toContain('frag');
  });

  it('handles invalid URLs without throwing', () => {
    const result = redactUrlForLog('not a url');
    expect(result.scheme).toBe('unknown');
    expect(result.host).toBe('invalid');
    expect(result.pathHash).toHaveLength(12);
  });
});

describe('redactUrlsInMessage', () => {
  it('replaces absolute URLs in error text', () => {
    expect(
      redactUrlsInMessage(
        'Failed to download file: get https://cdn.example.com/f?token=x ENOTFOUND',
      ),
    ).toBe('Failed to download file: get [REDACTED_URL] ENOTFOUND');
  });
});

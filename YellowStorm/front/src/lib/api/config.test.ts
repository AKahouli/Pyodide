import { describe, expect, it } from 'vitest';
import { resolveApiBaseUrl } from './config';

const UNRESOLVED = 'MY_APP_' + 'VITE_API_URL';

describe('resolveApiBaseUrl', () => {
  it('uses the value env.sh injected at container start', () => {
    expect(resolveApiBaseUrl('https://poc.back.yellowmind.ai/api/v1', undefined, false))
      .toBe('https://poc.back.yellowmind.ai/api/v1');
  });

  it('lets runtime injection override the inlined build arg', () => {
    expect(resolveApiBaseUrl('https://poc.back.yellowmind.ai/api/v1', 'http://localhost:3000/api/v1', false))
      .toBe('https://poc.back.yellowmind.ai/api/v1');
  });

  it('falls back to the build arg when the placeholder was not rewritten', () => {
    expect(resolveApiBaseUrl(UNRESOLVED, 'https://poc.back.yellowmind.ai/api/v1', false))
      .toBe('https://poc.back.yellowmind.ai/api/v1');
  });

  it('keeps the placeholder when production has no configuration at all', () => {
    expect(resolveApiBaseUrl(UNRESOLVED, undefined, false)).toBe(UNRESOLVED);
  });

  it('defaults dev to localhost when nothing is configured', () => {
    expect(resolveApiBaseUrl(UNRESOLVED, undefined, true)).toBe('http://localhost:3000/api/v1');
  });

  it('ignores blank injected and build-time values', () => {
    expect(resolveApiBaseUrl('   ', '  ', false)).toBe(UNRESOLVED);
    expect(resolveApiBaseUrl('  https://poc.back.yellowmind.ai/api/v1  ', undefined, false))
      .toBe('https://poc.back.yellowmind.ai/api/v1');
  });
});

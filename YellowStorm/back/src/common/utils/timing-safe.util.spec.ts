import { timingSafeStringEquals } from './timing-safe.util';

describe('timingSafeStringEquals', () => {
  it('matches equal non-empty strings', () => {
    expect(timingSafeStringEquals('secret-key', 'secret-key')).toBe(true);
    expect(timingSafeStringEquals('', '')).toBe(false);
    expect(timingSafeStringEquals(undefined, undefined)).toBe(false);
    expect(timingSafeStringEquals(null, null)).toBe(false);
  });

  it('rejects mismatched values and lengths', () => {
    expect(timingSafeStringEquals('secret-key', 'secret-keX')).toBe(false);
    expect(timingSafeStringEquals('secret-key', 'short')).toBe(false);
    expect(timingSafeStringEquals('secret-key', '')).toBe(false);
    expect(timingSafeStringEquals('', 'secret-key')).toBe(false);
    expect(timingSafeStringEquals(undefined, 'secret-key')).toBe(false);
  });
});

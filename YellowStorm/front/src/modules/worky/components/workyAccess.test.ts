import { describe, expect, it } from 'vitest';
import { canOperateStream } from '../streamAccess';

describe('canOperateStream', () => {
  it('fails closed until access is loaded', () => {
    expect(canOperateStream(false, undefined)).toBe(false);
    expect(canOperateStream(true, 'read')).toBe(false);
    expect(canOperateStream(true, 'write')).toBe(true);
    expect(canOperateStream(true, undefined)).toBe(true);
  });
});

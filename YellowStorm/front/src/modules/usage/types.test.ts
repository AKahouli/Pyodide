import { describe, expect, it } from 'vitest';
import { CURRENT_PLAN_COLOR, FEATURE_DISPLAY_NAMES, PLAN_COLORS, formatStorageSize } from './types';

describe('usage types utilities', () => {
  it('formats storage size including unlimited and zero', () => {
    expect(formatStorageSize(-1, 'No Limit')).toBe('No Limit');
    expect(formatStorageSize(0)).toBe('0 B');
    expect(formatStorageSize(1024)).toBe('1 KB');
    expect(formatStorageSize(1024 * 1024)).toBe('1 MB');
  });

  it('exposes feature and plan display constants', () => {
    expect(FEATURE_DISPLAY_NAMES.api_access).toBe('API Access');
    expect(PLAN_COLORS.free).toContain('slate');
    expect(CURRENT_PLAN_COLOR).toContain('ring-2');
  });
});

import { describe, expect, it } from 'vitest';
import en from './en.json';
import fr from './fr.json';

function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object'
      ? flattenKeys(value as Record<string, unknown>, path)
      : [path];
  });
}

describe('evaluation-logical-search locales', () => {
  it('keeps en and fr key sets identical', () => {
    const enKeys = flattenKeys(en as unknown as Record<string, unknown>);
    const frKeys = flattenKeys(fr as unknown as Record<string, unknown>);
    expect(frKeys.sort()).toEqual(enKeys.sort());
  });
});
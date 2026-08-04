import { describe, expect, it } from 'vitest';
import { readNextVersionFromPackageJson } from './read-next-version';

describe('readNextVersionFromPackageJson', () => {
  it('extracts a concrete version from dependencies', () => {
    expect(
      readNextVersionFromPackageJson(
        JSON.stringify({ dependencies: { next: '15.5.22' } }),
      ),
    ).toBe('15.5.22');
    expect(
      readNextVersionFromPackageJson(
        JSON.stringify({ dependencies: { next: '^15.5.22' } }),
      ),
    ).toBe('15.5.22');
  });

  it('returns null when next is missing or invalid', () => {
    expect(readNextVersionFromPackageJson('{}')).toBeNull();
    expect(readNextVersionFromPackageJson('not-json')).toBeNull();
  });
});

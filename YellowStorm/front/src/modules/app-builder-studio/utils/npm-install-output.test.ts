import { describe, expect, it } from 'vitest';
import { parseNpmAddedPackages } from './npm-install-output';

describe('parseNpmAddedPackages', () => {
  it('parses the added-packages summary', () => {
    expect(parseNpmAddedPackages('✔ added 347 packages in 12.3s')).toBe(347);
    expect(parseNpmAddedPackages('added 0 packages in 7.0s')).toBe(0);
    expect(parseNpmAddedPackages('added 1 package in 1s')).toBe(1);
  });

  it('returns null when the summary is missing', () => {
    expect(parseNpmAddedPackages('Resolving dependencies...')).toBeNull();
    expect(parseNpmAddedPackages('')).toBeNull();
  });
});

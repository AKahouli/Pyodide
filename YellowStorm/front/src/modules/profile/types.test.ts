import { describe, expect, it } from 'vitest';
import * as types from './types';

describe('profile types', () => {
  it('does not expose runtime exports', () => {
    expect(Object.keys(types)).toHaveLength(0);
  });
});

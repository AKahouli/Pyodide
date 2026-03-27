import { describe, expect, it } from 'vitest';
import * as hooks from './index';

describe('sidebar hooks index exports', () => {
  it('exports useAutoCollapse', () => {
    expect(hooks.useAutoCollapse).toBeDefined();
  });
});

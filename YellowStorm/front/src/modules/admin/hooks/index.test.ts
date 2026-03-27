import { describe, expect, it } from 'vitest';
import * as hooks from './index';

describe('admin hooks index', () => {
  it('exports hooks', () => {
    expect(hooks.usePermissions).toBeDefined();
    expect(hooks.useAdminAccess).toBeDefined();
  });
});

import { describe, expect, it } from 'vitest';
import * as moduleExports from './index';

describe('playbook index exports', () => {
  it('exports key module entries', () => {
    expect(moduleExports.PlaybookButton).toBeDefined();
    expect(moduleExports.PlaybookListPage).toBeDefined();
    expect(moduleExports.PlaybookCanvasPage).toBeDefined();
    expect(moduleExports.PlaybookExecutionPage).toBeDefined();
    expect(moduleExports.usePlaybookStore).toBeDefined();
  });
});

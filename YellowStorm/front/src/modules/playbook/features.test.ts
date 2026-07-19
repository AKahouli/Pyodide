import { describe, expect, it } from 'vitest';
import { resolvePlaybookFeatureFlag } from './features';

describe('resolvePlaybookFeatureFlag', () => {
  it('uses the Vite build value during development', () => {
    expect(resolvePlaybookFeatureFlag('true', 'false', true)).toBe(true);
    expect(resolvePlaybookFeatureFlag('false', 'true', true)).toBe(false);
  });

  it('uses the runtime-replaced value in production', () => {
    expect(resolvePlaybookFeatureFlag(undefined, 'true', false)).toBe(true);
    expect(resolvePlaybookFeatureFlag('true', 'MY_APP_VITE_PLAYBOOK_MCP_ASSISTANT_ENABLED', false)).toBe(false);
  });
});

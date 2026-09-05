import { describe, expect, it } from 'vitest';
import { isUserVisibleCheck } from './GovernanceReadinessPanel';

describe('governance readiness visibility', () => {
  it('keeps published workspace-set validation out of the connection-only MVP cycle', () => {
    expect(isUserVisibleCheck('published_workspace_set_valid')).toBe(false);
    expect(isUserVisibleCheck('knowledge_mapped')).toBe(true);
  });
});

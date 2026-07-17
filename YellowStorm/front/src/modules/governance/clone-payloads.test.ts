import { describe, expect, it } from 'vitest';
import { createGovernanceProgramClonePayload, createGovernanceScopeClonePayload } from './clone-payloads';
import type { GovernanceProgram, GovernanceScope } from './types';

const program: GovernanceProgram = {
  id: 'program-1',
  name: 'P'.repeat(160),
  description: 'Description',
  domain: 'public-services',
  defaultLanguage: 'fr',
  status: 'published',
  metadata: { internal: true },
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
};

const scope: GovernanceScope = {
  id: 'scope-1',
  programId: 'program-1',
  parentScopeId: 'scope-parent',
  agentIds: ['agent-1'],
  name: 'S'.repeat(160),
  type: 'municipality',
  status: 'inactive',
  metadata: { internal: true },
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
};

describe('governance clone payloads', () => {
  it('creates a bounded shallow program clone payload', () => {
    expect(createGovernanceProgramClonePayload(program, ' (copy)')).toEqual({
      name: `${'P'.repeat(153)} (copy)`,
      description: 'Description',
      domain: 'public-services',
      defaultLanguage: 'fr',
    });
  });

  it('creates a bounded shallow scope clone payload without sharing agent IDs', () => {
    const payload = createGovernanceScopeClonePayload(scope, ' (copy)');

    expect(payload).toEqual({
      name: `${'S'.repeat(153)} (copy)`,
      type: 'municipality',
      parentScopeId: 'scope-parent',
      agentIds: ['agent-1'],
    });
    expect(payload.agentIds).not.toBe(scope.agentIds);
  });
});

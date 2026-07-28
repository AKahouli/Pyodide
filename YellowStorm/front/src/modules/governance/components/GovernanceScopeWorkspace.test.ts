import { describe, expect, it } from 'vitest';
import type { GovernanceScope } from '@/modules/governance';
import { buildScopeSettingsPayload, createScopeSettingsDraft, isScopeSettingsDraftDirty } from './GovernanceScopeWorkspace';

function scopeWithDescription(description: string): GovernanceScope {
  return {
    id: 'scope-1',
    programId: 'program-1',
    agentIds: [],
    name: 'Credit Risk',
    type: 'municipality',
    status: 'active',
    metadata: {
      description,
      classification: { audience: 'public_facing', riskLevel: 'standard', compliance: 'none', stage: 'pilot' },
      review: { status: 'in_review' },
    },
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:00:00.000Z',
  };
}

describe('governance scope settings description', () => {
  it('normalizes hydrated whitespace without marking the draft dirty', () => {
    const scope = scopeWithDescription('  Credit risk guidance  ');
    const draft = createScopeSettingsDraft(scope);

    expect(draft.description).toBe('Credit risk guidance');
    expect(isScopeSettingsDraftDirty(scope, draft)).toBe(false);
  });

  it('includes a trimmed description without removing sibling metadata', () => {
    const scope = scopeWithDescription('Old guidance');
    const draft = { ...createScopeSettingsDraft(scope), description: '  New guidance  ' };

    expect(buildScopeSettingsPayload(scope, draft).metadata).toEqual({
      description: 'New guidance',
      classification: { audience: 'public_facing', riskLevel: 'standard', compliance: 'none', stage: 'pilot' },
      review: { status: 'in_review' },
    });
  });
});

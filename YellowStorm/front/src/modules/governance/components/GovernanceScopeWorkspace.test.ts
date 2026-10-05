import { describe, expect, it } from 'vitest';
import type { GovernanceScope, GovernanceScopeOverview, GovernanceWorkspaceBinding } from '@/modules/governance';
import type { Agent } from '@/modules/agent';
import type { Workspace } from '@/modules/workspace';
import { availableInviteUsers, buildScopeSettingsPayload, buildScopeWorkspaceBindingPayload, createScopeSettingsDraft, isEffectiveScopeWorkspaceBinding, isScopeSettingsDraftDirty, reviewChanges } from './GovernanceScopeWorkspace';

describe('scope collaborator self selection', () => {
  const self = { id: 'self', email: 'owner@example.test', firstName: 'Scope', lastName: 'Owner' };
  it('includes the signed-in owner when directory search excludes them', () => {
    expect(availableInviteUsers([], self, [], ' OWNER ')).toEqual([self]);
    expect(availableInviteUsers([], self, [], '')).toEqual([self]);
  });
  it('preserves membership exclusions and search matching without duplicating the owner', () => {
    expect(availableInviteUsers([self], self, [], 'owner')).toEqual([self]);
    expect(availableInviteUsers([], self, ['self'], 'owner')).toEqual([]);
    expect(availableInviteUsers([], self, [], 'someone else')).toEqual([]);
    expect(availableInviteUsers([], undefined, [], '')).toEqual([]);
  });
});

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

describe('scope workspace connections', () => {
  it('uses fixed MVP defaults instead of exposing ingestion and versioning settings', () => {
    expect(buildScopeWorkspaceBindingPayload('workspace-1', 'scope-1')).toEqual({
      workspaceId: 'workspace-1',
      visibility: 'scope_specific',
      scopeIds: ['scope-1'],
      ingestionMode: 'assisted',
      defaults: { validityMode: 'unknown' },
    });
  });

  it('does not present a disabled binding as connected', () => {
    const binding = { enabled: false, visibility: 'scope_specific', scopeIds: ['scope-1'] } as GovernanceWorkspaceBinding;

    expect(isEffectiveScopeWorkspaceBinding(binding, 'scope-1')).toBe(false);
  });
});

describe('scope review changes', () => {
  const workspaces = [
    { id: 'workspace-1', name: 'Clients' },
    { id: 'workspace-2', name: 'Credit Risk' },
  ] as Workspace[];

  function changesFor(draft: Record<string, unknown>, published?: Record<string, unknown>) {
    const overview = {
      draftRevision: {
        id: 'draft-1',
        allowedAgentIds: [],
        workspaceIds: [],
        workspaceBindingSnapshot: {},
        scopeSnapshot: {},
        audienceSnapshot: {},
        previousAudienceSnapshot: {},
        ...draft,
      },
      ...(published && {
        publishedRevision: {
          id: 'published-1',
          allowedAgentIds: [],
          workspaceIds: [],
          workspaceBindingSnapshot: {},
          scopeSnapshot: {},
          audienceSnapshot: {},
          previousAudienceSnapshot: {},
          ...published,
        },
      }),
    } as unknown as GovernanceScopeOverview;

    return reviewChanges(overview, [] as Agent[], workspaces, (key) => key);
  }

  it('reports each added workspace once when it appears in both revision fields', () => {
    const changes = changesFor({
      workspaceIds: ['workspace-1', 'workspace-2'],
      workspaceBindingSnapshot: {
        'binding-1': { workspaceId: 'workspace-1', visibility: 'scope_specific' },
        'binding-2': { workspaceId: 'workspace-2', visibility: 'scope_specific' },
      },
    });

    expect(changes).toEqual([
      { category: 'knowledge', kind: 'added', label: 'Clients' },
      { category: 'knowledge', kind: 'added', label: 'Credit Risk' },
    ]);
  });

  it('reports a removed workspace once when it appears in both published revision fields', () => {
    const changes = changesFor({}, {
      workspaceIds: ['workspace-1'],
      workspaceBindingSnapshot: { 'binding-1': { workspaceId: 'workspace-1', visibility: 'scope_specific' } },
    });

    expect(changes).toEqual([{ category: 'knowledge', kind: 'removed', label: 'Clients' }]);
  });

  it('reports at most one settings change for multiple binding snapshots of the same workspace', () => {
    const changes = changesFor({
      workspaceIds: ['workspace-1'],
      workspaceBindingSnapshot: {
        'binding-2': { workspaceId: 'workspace-1', visibility: 'scope_specific' },
        'binding-3': { workspaceId: 'workspace-1', visibility: 'scope_specific' },
      },
    }, {
      workspaceIds: ['workspace-1'],
      workspaceBindingSnapshot: {
        'binding-1': { workspaceId: 'workspace-1', visibility: 'program_shared' },
        'binding-old': { workspaceId: 'workspace-1', visibility: 'program_shared' },
      },
    });

    expect(changes).toEqual([{
      category: 'knowledge',
      kind: 'changed',
      label: 'Clients',
      detail: 'scopeShell.review.workspaceSettingsChanged',
    }]);
  });

  it('uses workspaceIds when snapshots are incomplete and ignores bindings without a workspace ID', () => {
    const changes = changesFor({
      workspaceIds: ['workspace-2'],
      workspaceBindingSnapshot: { 'binding-incomplete': { visibility: 'scope_specific' } },
    }, {
      workspaceIds: ['workspace-1'],
    });

    expect(changes).toEqual([
      { category: 'knowledge', kind: 'added', label: 'Credit Risk' },
      { category: 'knowledge', kind: 'removed', label: 'Clients' },
    ]);
  });
});

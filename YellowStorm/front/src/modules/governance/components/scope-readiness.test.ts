import { describe, expect, it } from 'vitest';
import type { GovernanceReadinessCheck, GovernanceScopeOverview } from '@/modules/governance';
import { findNextReadinessCheck, getGovernanceScopeTabs, getLatestDryRunRevisionNumber, getTabReadinessState, isCurrentDraftDryRunPassed, isScopeKnowledgeReady, sortReadinessChecks } from './scope-readiness';

function readinessCheck(key: string, status: GovernanceReadinessCheck['status'] = 'passed', targetType: GovernanceReadinessCheck['targetType'] = 'rule'): GovernanceReadinessCheck {
  return { key, label: key, status, severity: status === 'passed' ? 'info' : 'blocking', targetType };
}

function overviewWith(checks: GovernanceReadinessCheck[], published = false): GovernanceScopeOverview {
  return {
    readiness: { deploymentId: 'deployment-1', score: 0, status: 'blocked', blockers: [], warnings: [], checks },
    publishedRevision: published ? { id: 'revision-1' } : undefined,
  } as unknown as GovernanceScopeOverview;
}

describe('scope readiness sequence', () => {
  it('keeps the canonical lifecycle order with Dry-run before Review', () => {
    expect(getGovernanceScopeTabs(false)).toEqual(['overview', 'knowledge', 'agents', 'ownership', 'guardrails', 'testPublish', 'review', 'monitor']);
  });

  it('sorts checklist items by their lifecycle tab', () => {
    const checks = sortReadinessChecks([
      readinessCheck('knowledge_mapped'),
      readinessCheck('guardrails_reviewed', 'passed', 'agent'),
      readinessCheck('agents_mapped'),
      readinessCheck('scope_active'),
    ]);

    expect(checks.map((check) => check.key)).toEqual(['scope_active', 'knowledge_mapped', 'agents_mapped', 'guardrails_reviewed']);
  });

  it('chooses the first incomplete step even when a later step is a blocker', () => {
    const checks = [
      readinessCheck('ownership_assigned', 'failed'),
      readinessCheck('agents_mapped', 'warning'),
      readinessCheck('knowledge_mapped', 'passed', 'workspace'),
    ];

    // Agents precede ownership in the lifecycle regardless of audience feature flag.
    expect(findNextReadinessCheck(checks)?.key).toBe('agents_mapped');
  });

  it('marks Agents ready as soon as an assistant is mapped', () => {
    expect(getTabReadinessState('agents', overviewWith([readinessCheck('agents_mapped')]))).toBe('ready');
  });

  it('marks Knowledge ready independently from draft preparation', () => {
    expect(getTabReadinessState('knowledge', overviewWith([readinessCheck('knowledge_mapped', 'passed', 'workspace')]))).toBe('ready');
  });

  it('uses the readiness check rather than a connected workspace to determine usable knowledge', () => {
    const overview = overviewWith([readinessCheck('knowledge_mapped', 'failed', 'workspace')]);
    overview.knowledge = { sharedWorkspaces: [{ workspaceId: 'workspace-1' }], localWorkspaces: [], documents: [], reviewBlockers: [] } as unknown as GovernanceScopeOverview['knowledge'];

    expect(isScopeKnowledgeReady(overview)).toBe(false);
  });

  it('passes the draft dry-run gate only for a matching passed revision', () => {
    const overview = overviewWith([]);
    overview.draftRevision = { id: 'revision-2', revisionNumber: 2 } as GovernanceScopeOverview['draftRevision'];
    overview.publishedRevision = { id: 'revision-1', revisionNumber: 1 } as GovernanceScopeOverview['publishedRevision'];
    overview.latestDryRun = { revisionId: 'revision-1', status: 'passed' } as GovernanceScopeOverview['latestDryRun'];

    expect(isCurrentDraftDryRunPassed(overview)).toBe(false);
    expect(getLatestDryRunRevisionNumber(overview)).toBe(1);

    overview.latestDryRun = { revisionId: 'revision-2', status: 'passed' } as GovernanceScopeOverview['latestDryRun'];
    expect(isCurrentDraftDryRunPassed(overview)).toBe(true);
    expect(getLatestDryRunRevisionNumber(overview)).toBe(2);
  });

  it('shows Monitor as ready only after a revision is published', () => {
    expect(getTabReadinessState('monitor', overviewWith([]))).toBe('attention');
    expect(getTabReadinessState('monitor', overviewWith([], true))).toBe('ready');
  });
});

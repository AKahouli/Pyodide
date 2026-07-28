import { describe, expect, it } from 'vitest';
import type { GovernanceReadinessCheck, GovernanceScopeOverview } from '@/modules/governance';
import { findNextReadinessCheck, getTabReadinessState, governanceScopeTabs, sortReadinessChecks } from './scope-readiness';

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
  it('places Guardrails directly after Agents in the lifecycle', () => {
    const agentsIndex = governanceScopeTabs.indexOf('agents');
    expect(governanceScopeTabs[agentsIndex + 1]).toBe('guardrails');
  });

  it('sorts checklist items by their lifecycle tab', () => {
    const checks = sortReadinessChecks([
      readinessCheck('knowledge_mapped'),
      readinessCheck('guardrails_reviewed', 'passed', 'agent'),
      readinessCheck('agents_mapped'),
      readinessCheck('scope_active'),
    ]);

    expect(checks.map((check) => check.key)).toEqual(['scope_active', 'agents_mapped', 'guardrails_reviewed', 'knowledge_mapped']);
  });

  it('chooses the first incomplete step even when a later step is a blocker', () => {
    const checks = [
      readinessCheck('ownership_assigned', 'failed'),
      readinessCheck('agents_mapped', 'warning'),
      readinessCheck('knowledge_mapped', 'passed', 'source'),
    ];

    // Agents precede ownership in the lifecycle regardless of audience feature flag.
    expect(findNextReadinessCheck(checks)?.key).toBe('agents_mapped');
  });

  it('marks Agents ready as soon as an assistant is mapped', () => {
    expect(getTabReadinessState('agents', overviewWith([readinessCheck('agents_mapped')]))).toBe('ready');
  });

  it('marks Knowledge ready independently from draft preparation', () => {
    expect(getTabReadinessState('knowledge', overviewWith([readinessCheck('knowledge_mapped', 'passed', 'source')]))).toBe('ready');
  });

  it('shows Monitor as ready only after a revision is published', () => {
    expect(getTabReadinessState('monitor', overviewWith([]))).toBe('attention');
    expect(getTabReadinessState('monitor', overviewWith([], true))).toBe('ready');
  });
});

import type { GovernanceReadinessCheck, GovernanceScopeOverview } from '@/modules/governance';
import { governedConversationFeatures } from '@/config/governedConversationFeatures';

export type TabKey = 'overview' | 'knowledge' | 'agents' | 'audience' | 'ownership' | 'guardrails' | 'testPublish' | 'review' | 'monitor';

export const governanceScopeTabs: TabKey[] = ['overview', 'knowledge', 'agents', ...(governedConversationFeatures.conversationsEnabled ? ['audience' as const] : []), 'ownership', 'guardrails', 'testPublish', 'review', 'monitor'];

const tabCheckKeys: Partial<Record<TabKey, string[]>> = {
  overview: ['scope_active'],
  agents: ['agents_mapped', 'channel_ready'],
  guardrails: ['guardrails_reviewed'],
  knowledge: ['knowledge_mapped'],
  audience: ['audience_configured'],
  ownership: ['ownership_assigned'],
  testPublish: ['draft_revision', 'dry_run_passed'],
};

export function tabForReadinessCheck(check: Pick<GovernanceReadinessCheck, 'key' | 'targetType'>): TabKey {
  if (check.targetType === 'document' || check.targetType === 'workspace' || check.key.startsWith('document_') || check.key === 'knowledge_mapped' || check.key === 'published_workspace_set_valid') return 'knowledge';
  if (check.key === 'guardrails_reviewed') return 'guardrails';
  if (check.targetType === 'agent' || check.targetType === 'channel' || check.key === 'agents_mapped' || check.key === 'published_agent_roster_valid' || check.key.startsWith('channel_')) return 'agents';
  if (check.key === 'audience_configured') return 'audience';
  if (check.key === 'ownership_assigned') return 'ownership';
  if (check.targetType === 'dry_run' || check.key === 'draft_revision' || check.key === 'dry_run_passed') return 'testPublish';
  return 'overview';
}

export function sortReadinessChecks(checks: GovernanceReadinessCheck[]): GovernanceReadinessCheck[] {
  return [...checks].sort((left, right) => {
    const leftOrder = governanceScopeTabs.indexOf(tabForReadinessCheck(left));
    const rightOrder = governanceScopeTabs.indexOf(tabForReadinessCheck(right));
    return (leftOrder === -1 ? governanceScopeTabs.length : leftOrder) - (rightOrder === -1 ? governanceScopeTabs.length : rightOrder);
  });
}

export function findNextReadinessCheck(checks: GovernanceReadinessCheck[]): GovernanceReadinessCheck | undefined {
  return sortReadinessChecks(checks).find((check) => check.status !== 'passed');
}

export function getTabReadinessState(tab: TabKey, overview: GovernanceScopeOverview): 'ready' | 'attention' {
  if (tab === 'monitor') return overview.publishedRevision ? 'ready' : 'attention';

  const checks = tab === 'review'
    ? overview.readiness.checks.filter((check) => !check.key.startsWith('document_'))
    : overview.readiness.checks.filter((check) => {
      if (tab === 'knowledge' && (check.targetType === 'document' || check.key.startsWith('document_'))) return true;
      return tabCheckKeys[tab]?.includes(check.key) ?? false;
    });

  return checks.length > 0 && checks.every((check) => check.status === 'passed') ? 'ready' : 'attention';
}

export function isScopeKnowledgeReady(overview: GovernanceScopeOverview): boolean {
  return overview.readiness.checks.some((check) => check.key === 'knowledge_mapped' && check.status === 'passed');
}

export function isCurrentDraftDryRunPassed(overview: GovernanceScopeOverview): boolean {
  return Boolean(overview.draftRevision && overview.latestDryRun?.revisionId === overview.draftRevision.id && overview.latestDryRun.status === 'passed');
}

export function getLatestDryRunRevisionNumber(overview: GovernanceScopeOverview): number | undefined {
  if (!overview.latestDryRun) return undefined;
  if (overview.latestDryRun.revisionId === overview.draftRevision?.id) return overview.draftRevision.revisionNumber;
  if (overview.latestDryRun.revisionId === overview.publishedRevision?.id) return overview.publishedRevision.revisionNumber;
  return undefined;
}

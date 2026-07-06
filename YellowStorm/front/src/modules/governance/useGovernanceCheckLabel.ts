import { useModuleTranslation } from '@/modules/localization';

const checkLabelKeys = {
  scope_active: 'scopeShell.checks.scope_active',
  agents_mapped: 'scopeShell.checks.agents_mapped',
  knowledge_mapped: 'scopeShell.checks.knowledge_mapped',
  deployment_exists: 'scopeShell.checks.deployment_exists',
  draft_revision: 'scopeShell.checks.draft_revision',
  dry_run_passed: 'scopeShell.checks.dry_run_passed',
  channel_ready: 'scopeShell.checks.channel_ready',
} as const;

const blockerLabelKeys = {
  scope_active: 'scopeShell.blockers.scope_active',
  agents_mapped: 'scopeShell.blockers.agents_mapped',
  knowledge_mapped: 'scopeShell.blockers.knowledge_mapped',
  deployment_exists: 'scopeShell.blockers.deployment_exists',
  draft_revision: 'scopeShell.blockers.draft_revision',
  dry_run_passed: 'scopeShell.blockers.dry_run_passed',
  channel_ready: 'scopeShell.blockers.channel_ready',
} as const;

const channelNameKeys = {
  widget: 'scopeShell.channels.widget',
  whatsapp: 'scopeShell.channels.whatsapp',
  telegram: 'scopeShell.channels.telegram',
  api: 'scopeShell.channels.api',
} as const;

const CHANNEL_OVERVIEW_CHECK_PATTERN = /^channel_(?:(.+):)?([^:]+)_ready$/;
const CHANNEL_DEPLOYMENT_CHECK_PATTERN = /^[^:]+:([^:]+)_ready$/;

export function useGovernanceCheckLabel() {
  const { t } = useModuleTranslation('governance');

  const channelName = (key: string): string | undefined => {
    const overviewMatch = key.match(CHANNEL_OVERVIEW_CHECK_PATTERN);
    const deploymentMatch = key.match(CHANNEL_DEPLOYMENT_CHECK_PATTERN);
    const channel = overviewMatch?.[2] ?? deploymentMatch?.[1];
    if (!channel) return undefined;
    const nameKey = channelNameKeys[channel as keyof typeof channelNameKeys];
    return nameKey ? t(nameKey) : channel;
  };

  const translateCheck = (key: string, fallback: string): string => {
    if (key.startsWith('source_')) return fallback;
    const channel = channelName(key);
    if (channel) return t('scopeShell.checks.channelReady', { channel });
    const translationKey = checkLabelKeys[key as keyof typeof checkLabelKeys];
    return translationKey ? t(translationKey) : fallback;
  };

  const translateBlocker = (key: string, fallback: string): string => {
    if (key.startsWith('source_')) return fallback;
    const channel = channelName(key);
    if (channel) return t('scopeShell.blockers.channelNotReady', { channel });
    const translationKey = blockerLabelKeys[key as keyof typeof blockerLabelKeys];
    return translationKey ? t(translationKey) : fallback;
  };

  return { translateCheck, translateBlocker };
}

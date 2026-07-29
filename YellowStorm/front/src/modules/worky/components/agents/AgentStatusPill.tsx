import type { JSX } from 'react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { WorkyAgentStatus } from '../../agents/agentModel';

// Full literal class names so Tailwind's scanner emits them.
const PILL: Record<WorkyAgentStatus, { wrap: string; dot: string; key: string }> = {
  working: { wrap: 'bg-worky-working/15 text-worky-working', dot: 'bg-worky-working', key: 'agents.status.working' },
  blocked: { wrap: 'bg-worky-blocked/15 text-worky-blocked', dot: 'bg-worky-blocked', key: 'agents.status.blocked' },
  idle: { wrap: 'bg-worky-idle/15 text-worky-idle', dot: 'bg-worky-idle', key: 'agents.status.idle' },
  done: { wrap: 'bg-worky-done/15 text-worky-done', dot: 'bg-worky-done', key: 'agents.status.done' },
};

export function AgentStatusPill({ status, className }: { status: WorkyAgentStatus; className?: string }): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const s = PILL[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap',
        s.wrap,
        className,
      )}
    >
      <span className={cn('size-1.5 rounded-full', s.dot)} />
      {t(s.key)}
    </span>
  );
}

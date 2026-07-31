import { useState, type JSX, type ComponentType } from 'react';
import { Check, Play, ShieldAlert, GitBranch, User, CircleDot } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { useStreamBudget } from '../../query/hooks';
import { useWorkyUiStore } from '../../uiStore';
import { ChatMessageThread } from '../ChatMessageThread';
import { PromptBar } from '../PromptBar';

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  check: Check,
  play: Play,
  'shield-alert': ShieldAlert,
  'git-branch': GitBranch,
  'user-round': User,
};
const TONE: Record<string, string> = {
  working: 'text-worky-working',
  blocked: 'text-worky-blocked',
  done: 'text-worky-done',
  primary: 'text-primary',
  muted: 'text-muted-foreground',
};

/**
 * Desktop right rail: Chat / Activity tabs over a budget mini.
 *
 * Chat is the default tab and holds the manager thread + composer, so the
 * Chief-of-Staff conversation is reachable without opening a sheet. Voice stays
 * in the bottom-center dock (`WorkyVoiceDock`).
 *
 * FLAG: the activity feed is live-only — there is no persisted activity history
 * endpoint, so it starts empty on load and resets when switching streams.
 */
export function WorkyActivityRail({
  streamId,
  onWhatsAppClick,
  whatsappConnected,
}: {
  streamId: string;
  onWhatsAppClick?: () => void;
  whatsappConnected?: boolean;
}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const [tab, setTab] = useState<'chat' | 'activity'>('chat');
  const activity = useWorkyUiStore((s) => s.recentActivity);
  const { data: budget } = useStreamBudget(streamId);
  const pct = budget && budget.limitUsd > 0 ? Math.min(100, (budget.spendUsd / budget.limitUsd) * 100) : 0;

  return (
    <aside className="hidden w-[344px] shrink-0 flex-col gap-4 border-l border-border bg-card p-4 lg:flex">
      <div className="flex gap-1 rounded-lg border border-border bg-muted p-0.5">
        {(['chat', 'activity'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setTab(v)}
            aria-pressed={tab === v}
            data-testid={`worky-rail-tab-${v}`}
            className={cn(
              'flex-1 rounded-md py-1.5 text-sm font-semibold transition-colors',
              tab === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(v === 'chat' ? 'orchestrator.tabs.chat' : 'activity.title')}
          </button>
        ))}
      </div>

      {tab === 'chat' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="worky-rail-chat">
          <ChatMessageThread streamId={streamId} />
          <PromptBar
            streamId={streamId}
            onWhatsAppClick={onWhatsAppClick}
            whatsappConnected={whatsappConnected}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="worky-rail-activity">
          {activity.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t('activity.empty')}</p>
          ) : (
            <div className="flex flex-col">
              {activity.map((a) => {
                const Icon = ICONS[a.icon] ?? CircleDot;
                return (
                  <div key={a.key} className="flex items-start gap-3 py-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                      <Icon className={cn('size-3.5', TONE[a.tone] ?? 'text-muted-foreground')} />
                    </span>
                    <span className="text-sm text-foreground">{a.text}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {budget ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-muted/40 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-foreground">{t('budget.title')}</span>
            <span className="text-xs text-muted-foreground">
              ${(budget.spendUsd ?? 0).toFixed(2)} / ${budget.limitUsd ?? 0}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : null}
    </aside>
  );
}

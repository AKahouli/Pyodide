import { useState, type JSX, type ComponentType } from 'react';
import { Check, Play, ShieldAlert, GitBranch, User, CircleDot } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { useWorkyUiStore } from '../../uiStore';
import { useResizableSidebar } from '../../useResizableSidebar';
import { ChatMessageThread } from '../ChatMessageThread';
import { PromptBar } from '../PromptBar';
import type { WorkyExecutiveViewModel } from '../../executive/executiveModel';
import type { WorkyTask } from '../../types';

const SIDEBAR_WIDTH_STORAGE_KEY = 'worky:chat-sidebar-width';

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
 * Desktop right rail: Chat / Activity tabs.
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
  model,
  selectedTask,
}: {
  streamId: string;
  model?: WorkyExecutiveViewModel;
  selectedTask?: WorkyTask | null;
}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const [tab, setTab] = useState<'chat' | 'activity'>('chat');
  const activity = useWorkyUiStore((s) => s.recentActivity);
  const { width, isResizing, separatorProps } = useResizableSidebar(SIDEBAR_WIDTH_STORAGE_KEY);

  return (
    <aside
      data-testid="worky-chat-sidebar"
      style={{ width }}
      className="relative hidden shrink-0 flex-col border-l border-border bg-card lg:flex"
    >
      {/* Drag (or ArrowLeft/ArrowRight, double-click to reset) to resize. */}
      <div
        {...separatorProps}
        data-testid="worky-rail-resize"
        aria-label={t('orchestrator.resize')}
        className={cn(
          'group absolute left-0 top-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-col-resize touch-none',
          'focus-visible:outline-none',
        )}
      >
        <span
          className={cn(
            'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors',
            'group-hover:bg-primary group-focus-visible:bg-primary',
            isResizing && 'bg-primary',
          )}
        />
      </div>

      <div className='border-b border-border/60 px-4 py-3'>
        <p className='text-xs font-bold uppercase tracking-[0.16em] text-foreground'>{t('executive.rail.title')}</p>
        <p className='mt-1 text-xs leading-5 text-muted-foreground'>
          {t('command.rail.summary', { active: model?.summary.active ?? 0, review: (model?.summary.blocked ?? 0) + (model?.summary.needsInput ?? 0) })}
        </p>
      </div>
      <div className="flex shrink-0 gap-1 rounded-lg border border-border bg-muted p-0.5 m-3 mb-2">
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
        // Edge-to-edge: no side padding and no thread border, so the narrow rail
        // spends its width on message text rather than chrome.
        <div className="flex min-h-0 flex-1 flex-col" data-testid="worky-rail-chat">
          <ChatMessageThread
            streamId={streamId}
            className="rounded-none border-x-0 border-b-0 border-t border-border/60 bg-transparent"
          />
          <PromptBar
            streamId={streamId}
            sessionStatus={model?.session?.status}
            contextTask={selectedTask}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" data-testid="worky-rail-activity">
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
    </aside>
  );
}

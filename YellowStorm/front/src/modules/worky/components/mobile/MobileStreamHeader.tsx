import type { JSX } from 'react';
import { ChevronLeft, MessageSquare } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { useStream } from '../../query/hooks';
import { useStreamAgents } from '../../agents/useStreamAgents';

/**
 * Mobile app bar: back, the stream title with an "N agents · Status" subtitle,
 * and a chat button that opens the (hidden-by-default) manager chat.
 */
export function MobileStreamHeader({
  streamId,
  onBack,
  onOpenChat,
}: {
  streamId: string;
  onBack: () => void;
  onOpenChat: () => void;
}): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const { data: stream } = useStream(streamId);
  const { agents } = useStreamAgents();

  const statusLabel = stream ? t(`badges.status.${stream.status}` as 'badges.status.active') : '';
  const subtitle = `${t('agents.team.count', { count: agents.length })} · ${statusLabel}`;

  return (
    <div className="flex items-center gap-2 px-4 pt-2 pb-3">
      <button
        type="button"
        onClick={onBack}
        aria-label={t('header.back')}
        className="-ml-1 shrink-0 text-muted-foreground"
      >
        <ChevronLeft className="size-6" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-lg font-bold text-foreground">{stream?.title ?? ''}</div>
        <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
      </div>
      <button
        type="button"
        onClick={onOpenChat}
        aria-label={t('orchestrator.tabs.chat')}
        className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground"
      >
        <MessageSquare className="size-[18px]" />
      </button>
    </div>
  );
}

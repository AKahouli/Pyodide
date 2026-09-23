import type { JSX } from 'react';
import { ChevronLeft, Network } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { useStream } from '../../query/hooks';
import { useStreamAgents } from '../../agents/useStreamAgents';

/**
 * Mobile app bar: back, the stream title with an "N agents · Status" subtitle,
 * without duplicating the bottom navigation controls.
 */
export function MobileStreamHeader({
  streamId,
  onBack,
  onOpenGraph,
  graphAvailable,
}: {
  streamId: string;
  onBack: () => void;
  onOpenGraph: () => void;
  graphAvailable: boolean;
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
        onClick={onOpenGraph}
        disabled={!graphAvailable}
        aria-label={t('graph.openFromHeader')}
        title={t('graph.openFromHeader')}
        data-testid="worky-header-graph"
        className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border text-foreground disabled:opacity-40"
      >
        <Network className="size-5" />
      </button>
    </div>
  );
}

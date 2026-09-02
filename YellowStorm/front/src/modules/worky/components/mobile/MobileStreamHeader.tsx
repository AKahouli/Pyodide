import type { JSX } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { useStream } from '../../query/hooks';
import { useStreamAgents } from '../../agents/useStreamAgents';
import { CompanionExecutionControls } from '../executive/CompanionExecutionControls';

/**
 * Mobile app bar: back, the stream title with an "N agents · Status" subtitle,
 * and controls for the active Companion execution.
 */
export function MobileStreamHeader({
  streamId,
  onBack,
  sessionStatus,
}: {
  streamId: string;
  onBack: () => void;
  sessionStatus?: string | null;
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
      <CompanionExecutionControls streamId={streamId} sessionStatus={sessionStatus} compact />
    </div>
  );
}

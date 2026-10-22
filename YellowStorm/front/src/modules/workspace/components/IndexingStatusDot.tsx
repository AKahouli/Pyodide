import { cn } from '@/lib/utils';
import type { WorkspaceFile } from '../types';
import { useModuleTranslation } from '@/modules/localization';
import { INDEXING_TONE } from './indexing-status-tone';

/** Small colored dot reflecting a file's vectorstore indexing status. */
export function IndexingStatusDot({ status, error }: { status?: WorkspaceFile['indexingStatus']; error?: string }) {
  const { t } = useModuleTranslation('workspace');
  const config: Record<NonNullable<WorkspaceFile['indexingStatus']>, { tone: keyof typeof INDEXING_TONE; pulse?: boolean }> = {
    ready: { tone: 'done' },
    failed: { tone: 'failed' },
    pending: { tone: 'inProgress', pulse: true },
    processing: { tone: 'inProgress', pulse: true },
    none: { tone: 'idle' },
  };
  const cfg = config[status ?? 'none'] ?? config.none;
  const label = t(`indexing.${status ?? 'none'}`);
  const title = status === 'failed' && error ? `${label}: ${error}` : label;
  return (
    <span
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', INDEXING_TONE[cfg.tone].dot, cfg.pulse && 'animate-pulse')}
      title={title}
      aria-label={title}
      role='img'
    />
  );
}

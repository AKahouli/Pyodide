import { cn } from '@/lib/utils';
import type { WorkspaceFile } from '../types';
import { useModuleTranslation } from '@/modules/localization';

/** Small colored dot reflecting a file's vectorstore indexing status. */
export function IndexingStatusDot({ status, error }: { status?: WorkspaceFile['indexingStatus']; error?: string }) {
  const { t } = useModuleTranslation('workspace');
  const config: Record<NonNullable<WorkspaceFile['indexingStatus']>, { color: string; pulse?: boolean }> = {
    ready: { color: 'bg-green-500' },
    failed: { color: 'bg-red-500' },
    pending: { color: 'bg-orange-500', pulse: true },
    processing: { color: 'bg-orange-500', pulse: true },
    none: { color: 'bg-muted-foreground/40' },
  };
  const cfg = config[status ?? 'none'] ?? config.none;
  const label = t(`indexing.${status ?? 'none'}`);
  const title = status === 'failed' && error ? `${label}: ${error}` : label;
  return (
    <span
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', cfg.color, cfg.pulse && 'animate-pulse')}
      title={title}
      aria-label={title}
      role='img'
    />
  );
}

import { cn } from '@/lib/utils';
import type { WorkspaceFile } from '../types';

/** Small colored dot reflecting a file's vectorstore indexing status. */
export function IndexingStatusDot({ status, error }: { status?: WorkspaceFile['indexingStatus']; error?: string }) {
  const config: Record<NonNullable<WorkspaceFile['indexingStatus']>, { color: string; pulse?: boolean; label: string }> = {
    ready: { color: 'bg-green-500', label: 'Indexé' },
    failed: { color: 'bg-red-500', label: "Échec de l'indexation" },
    pending: { color: 'bg-orange-500', pulse: true, label: 'Indexation en attente' },
    processing: { color: 'bg-orange-500', pulse: true, label: 'Indexation en cours' },
    none: { color: 'bg-muted-foreground/40', label: 'Non indexé' },
  };
  const cfg = config[status ?? 'none'] ?? config.none;
  const title = status === 'failed' && error ? `${cfg.label} : ${error}` : cfg.label;
  return (
    <span
      className={cn('inline-block h-2 w-2 shrink-0 rounded-full', cfg.color, cfg.pulse && 'animate-pulse')}
      title={title}
      aria-label={title}
      role='img'
    />
  );
}

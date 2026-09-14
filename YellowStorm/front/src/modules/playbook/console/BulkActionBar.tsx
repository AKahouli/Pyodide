import { Copy, Play, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';

/** Floating pill, bottom-centre, appears when rows are selected (§7.10). */
export function BulkActionBar({
  count,
  onRun,
  onClone,
  onDelete,
  onClear,
}: {
  count: number;
  onRun: () => void;
  onClone: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const { t } = useModuleTranslation('playbook');
  if (count === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label={t('console.bulk.label')}
      data-testid="bulk-bar"
      className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-popover/95 px-2 py-1.5 shadow-lg backdrop-blur transition-transform motion-reduce:transition-none"
    >
      <span className="px-2 text-xs text-muted-foreground" data-testid="bulk-count">
        {t('list.selected', { count })}
      </span>
      <Button variant="ghost" size="sm" className="h-7 gap-1 rounded-full px-2.5 text-xs" onClick={onRun}>
        <Play className="h-3 w-3" aria-hidden />
        {t('console.action.runNow')}
      </Button>
      <Button variant="ghost" size="sm" className="h-7 gap-1 rounded-full px-2.5 text-xs" onClick={onClone}>
        <Copy className="h-3 w-3" aria-hidden />
        {t('card.clone')}
      </Button>
      <Button variant="ghost" size="sm" className="h-7 gap-1 rounded-full px-2.5 text-xs text-destructive hover:text-destructive" onClick={onDelete}>
        <Trash2 className="h-3 w-3" aria-hidden />
        {t('list.deleteSelected')}
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" aria-label={t('console.bulk.clear')} onClick={onClear}>
        <X className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </div>
  );
}

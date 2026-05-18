import { Loader2, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';

interface AgentHubBulkActionBarProps {
  selectedCount: number;
  inFlight: boolean;
  done: number;
  total: number;
  onClear: () => void;
  onDelete: () => void;
}

export function AgentHubBulkActionBar({
  selectedCount,
  inFlight,
  done,
  total,
  onClear,
  onDelete,
}: AgentHubBulkActionBarProps) {
  const { t } = useModuleTranslation('agent');

  return (
    <div className="flex items-center gap-3 rounded-md border bg-muted/50 px-4 py-2">
      <span className="text-sm font-medium">
        {t('hub.bulkActions.selected', { count: selectedCount })}
      </span>
      {inFlight && (
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('hub.bulkActions.deleting', { done, total })}
        </span>
      )}
      <div className="ml-auto flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onClear} disabled={inFlight}>
          <X className="mr-1.5 h-3.5 w-3.5" />
          {t('hub.select.clear')}
        </Button>
        <Button variant="destructive" size="sm" onClick={onDelete} disabled={inFlight}>
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          {t('hub.bulkActions.delete')}
        </Button>
      </div>
    </div>
  );
}

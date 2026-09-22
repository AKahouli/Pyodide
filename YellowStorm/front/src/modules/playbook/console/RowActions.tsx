import { Copy, Link2, MoreHorizontal, Pencil, Play, CalendarClock, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useModuleTranslation } from '@/modules/localization';
import type { PlaybookVM } from '../utils/playbookVM';
import type { PlaybookActions } from './types';

/** Row action cluster (Run · Edit · ⋯) shared by the table and card views. */
export function RowActions({ vm, actions, className }: { vm: PlaybookVM; actions: PlaybookActions; className?: string }) {
  const { t } = useModuleTranslation('playbook');
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    fn();
  };
  return (
    <div className={`flex items-center justify-end gap-0.5 ${className ?? ''}`} onClick={(e) => e.stopPropagation()}>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        aria-label={t('console.action.run', { name: vm.name })}
        title={t('console.action.run', { name: vm.name })}
        onClick={stop(() => actions.onRun(vm))}
      >
        <Play className="h-3.5 w-3.5" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        aria-label={t('console.action.edit', { name: vm.name })}
        title={t('console.action.edit', { name: vm.name })}
        onClick={stop(() => actions.onEditCanvas(vm))}
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={t('card.actions', { name: vm.name })}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={() => actions.onOpenTriggers(vm)}>
            <CalendarClock className="mr-2 h-4 w-4" />
            {t('card.openTriggers')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.onIntegration(vm)}>
            <Link2 className="mr-2 h-4 w-4" />
            {t('card.integration.open')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.onClone(vm)}>
            <Copy className="mr-2 h-4 w-4" />
            {t('card.clone')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.onEditDetails(vm)}>
            <Pencil className="mr-2 h-4 w-4" />
            {t('card.edit')}
          </DropdownMenuItem>
          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => actions.onDelete(vm)}>
            <Trash2 className="mr-2 h-4 w-4" />
            {t('card.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

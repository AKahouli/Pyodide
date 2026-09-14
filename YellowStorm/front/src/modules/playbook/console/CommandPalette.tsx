import { LayoutGrid, Rows, Search, SquareKanban, Star, UserCheck, Zap } from 'lucide-react';
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { useModuleTranslation } from '@/modules/localization';
import type { PlaybookVM } from '../utils/playbookVM';
import { StatusPill } from './atoms';
import type { ConsoleView, SegmentId, SortKey } from './consoleState';

export interface PaletteActions {
  onNew: () => void;
  onSegment: (segment: SegmentId) => void;
  onNeedsHuman: () => void;
  onView: (view: ConsoleView) => void;
  onSort: (sort: SortKey) => void;
  onOpen: (vm: PlaybookVM) => void;
}

/** ⌘K command palette (§7.9). Keyboard navigation is cmdk's own. */
export function CommandPalette({
  open,
  onOpenChange,
  vms,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vms: PlaybookVM[];
  actions: PaletteActions;
}) {
  const { t } = useModuleTranslation('playbook');
  const run = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title={t('console.palette.label')}>
      <CommandInput placeholder={t('console.palette.placeholder')} />
      <CommandList>
        <CommandEmpty>{t('console.palette.empty')}</CommandEmpty>
        <CommandGroup heading={t('console.palette.commands')}>
          <CommandItem onSelect={run(actions.onNew)}>
            <Zap className="mr-2 h-4 w-4" aria-hidden />
            {t('list.newPlaybook')}
          </CommandItem>
          <CommandItem onSelect={run(actions.onNeedsHuman)}>
            <UserCheck className="mr-2 h-4 w-4" aria-hidden />
            {t('console.palette.needsHuman')}
          </CommandItem>
          <CommandItem onSelect={run(() => actions.onSegment('live'))}>
            <Search className="mr-2 h-4 w-4" aria-hidden />
            {t('console.segment.live')}
          </CommandItem>
          <CommandItem onSelect={run(() => actions.onSegment('fav'))}>
            <Star className="mr-2 h-4 w-4" aria-hidden />
            {t('console.segment.fav')}
          </CommandItem>
          <CommandItem onSelect={run(() => actions.onView('table'))}>
            <Rows className="mr-2 h-4 w-4" aria-hidden />
            {t('console.view.table')}
          </CommandItem>
          <CommandItem onSelect={run(() => actions.onView('board'))}>
            <SquareKanban className="mr-2 h-4 w-4" aria-hidden />
            {t('console.view.board')}
          </CommandItem>
          <CommandItem onSelect={run(() => actions.onView('cards'))}>
            <LayoutGrid className="mr-2 h-4 w-4" aria-hidden />
            {t('console.view.cards')}
          </CommandItem>
          <CommandItem onSelect={run(() => actions.onSort('reliability'))}>{t('console.palette.sortReliability')}</CommandItem>
          <CommandItem onSelect={run(() => actions.onSort('lastRun'))}>{t('list.sort.lastExecutionAt')}</CommandItem>
          <CommandItem onSelect={run(() => actions.onSort('name'))}>{t('list.sort.name')}</CommandItem>
        </CommandGroup>
        {vms.length > 0 && (
          <CommandGroup heading={t('console.palette.playbooks')}>
            {vms.slice(0, 6).map((vm) => (
              <CommandItem key={vm.id} value={`${vm.name} ${vm.id}`} onSelect={run(() => actions.onOpen(vm))}>
                <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{vm.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                      {vm.stepCount === null ? '—' : t('console.stepsCount', { count: vm.stepCount })}
                    </span>
                    <StatusPill state={vm.state} />
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}

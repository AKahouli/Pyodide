import { MoreHorizontal, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useModuleTranslation } from '@/modules/localization';
import type { PlaybookVM } from '../utils/playbookVM';
import { RelativeTime, ReliabilityStrip, StatusPill } from './atoms';
import type { PlaybookActions } from './types';

/**
 * Secondary card view with fixed internal geometry so every card in a row
 * aligns (defect B3): 2-line purpose block with min-height, one-line footer.
 */
export function PlaybookCardsView({ vms, actions }: { vms: PlaybookVM[]; actions: PlaybookActions }) {
  const { t } = useModuleTranslation('playbook');
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(268px,1fr))] gap-3 p-4 sm:px-6">
      {vms.map((vm) => (
        <div
          key={vm.id}
          onClick={() => actions.onOpen(vm)}
          className="group flex cursor-pointer flex-col rounded-lg border bg-card text-card-foreground shadow-sm transition-colors hover:border-primary/50"
        >
          <div className="flex items-start justify-between gap-2 p-3 pb-0">
            <button
              type="button"
              onClick={() => actions.onOpen(vm)}
              className="min-w-0 flex-1 truncate text-left text-sm font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              title={vm.name}
            >
              {vm.name}
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); actions.onToggleFavorite(vm); }}
              aria-label={t(vm.isFavorite ? 'card.unfavorite' : 'card.favorite')}
              aria-pressed={vm.isFavorite}
              className="shrink-0 rounded focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Star className={`h-3.5 w-3.5 ${vm.isFavorite ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/70 hover:text-foreground'}`} aria-hidden />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label={t('card.actions', { name: vm.name })}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onSelect={() => actions.onRun(vm)}>{t('console.action.runNow')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => actions.onEditCanvas(vm)}>{t('card.edit')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => actions.onOpenTriggers(vm)}>{t('card.openTriggers')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => actions.onClone(vm)}>{t('card.clone')}</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => actions.onEditDetails(vm)}>{t('card.edit')}</DropdownMenuItem>
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => actions.onDelete(vm)}>
                  {t('card.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <p className="line-clamp-2 min-h-[2.6em] px-3 pt-1 text-xs text-muted-foreground">{vm.purpose}</p>
          {vm.labels.length > 0 && (
            <div className="flex flex-wrap gap-1 px-3 pt-1.5">
              {vm.labels.map((label) => (
                <span key={label} className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">{label}</span>
              ))}
            </div>
          )}
          <div className="px-3 pb-3 pt-2">
            <StatusPill state={vm.state} />
          </div>
          <div className="mt-auto flex items-center justify-between gap-2 border-t px-3 py-2 text-[11px] text-muted-foreground">
            <span className="font-mono tabular-nums">{vm.stepCount === null ? '—' : t('console.stepsCount', { count: vm.stepCount })}</span>
            <RelativeTime iso={vm.lastRun?.startedAt ?? null} className="text-[11px]" />
            {vm.history && vm.history.length > 0 && <ReliabilityStrip history={vm.history} />}
          </div>
        </div>
      ))}
    </div>
  );
}

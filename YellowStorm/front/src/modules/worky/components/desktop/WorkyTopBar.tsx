import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, ChevronDown, LayoutGrid } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useStream, useStreams } from '../../query/hooks';

/**
 * Desktop Worky top bar: logo + wordmark and the stream switcher. The switcher
 * is the only stream-to-stream navigation on this page now that the sidebar is
 * gone, so it lists every stream and links back to the landing dashboard.
 *
 * Stream search lives on the landing dashboard only. Budget is shown by
 * `WorkyActivityRail`, so it is not duplicated here.
 */
export function WorkyTopBar({ streamId }: { streamId: string }): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const navigate = useNavigate();
  const { data: stream } = useStream(streamId);
  const { data: streams = [] } = useStreams();

  return (
    <div className="flex h-14 shrink-0 items-center border-b border-border bg-card px-4">
      <div className="flex items-center gap-3">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Zap className="size-4" />
        </span>
        <span className="text-base font-bold text-foreground">Worky</span>
        <span className="h-6 w-px bg-border" />
        <DropdownMenu>
          <DropdownMenuTrigger
            data-testid="worky-stream-switcher"
            aria-label={t('dashboard.switchStream')}
            className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5 transition-colors hover:bg-accent/40"
          >
            <span className="size-2 shrink-0 rounded-full bg-worky-working" />
            <span className="max-w-[220px] truncate text-sm font-semibold text-foreground">
              {stream?.title ?? ''}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
            {streams.map((s) => (
              <DropdownMenuItem
                key={s.id}
                onSelect={() => navigate(`/worky/${s.id}`)}
                className={cn('gap-2', s.id === streamId && 'font-semibold')}
              >
                <span className="size-2 shrink-0 rounded-full bg-worky-working" />
                <span className="truncate">{s.title}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate('/worky')} className="gap-2">
              <LayoutGrid className="size-4" />
              {t('dashboard.title')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

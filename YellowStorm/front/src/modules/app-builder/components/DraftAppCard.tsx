import { memo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, MessageSquare, PencilLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { AppViewMode } from '../hooks/useAppBuilderFilters';
import type { DraftApp } from '../types';
import { DeleteDraftAppButton } from './DeleteDraftAppButton';
import { AppRevisionMeta } from './AppRevisionMeta';
import { AppAiBadge } from './AppAiBadge';

interface DraftAppCardProps {
  app: DraftApp;
  view?: AppViewMode;
}

function ActionButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          className='h-7 w-7'
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export const DraftAppCard = memo(function DraftAppCard({
  app,
  view = 'grid',
}: DraftAppCardProps) {
  const { t } = useModuleTranslation('app-builder');
  const navigate = useNavigate();
  const title = app.title || t('card.untitled');

  const statusBadge =
    app.deployStatus === 'deploying' ? (
      <Badge variant='outline' className='shrink-0 gap-1 border-amber-500/30 px-1.5 py-0 text-[10px] text-amber-700 dark:text-amber-300'>
        <Loader2 className='h-3 w-3 animate-spin' />
        {t('card.draftStatus.deploying')}
      </Badge>
    ) : app.deployStatus === 'error' ? (
      <Badge variant='outline' className='shrink-0 gap-1 border-destructive/40 px-1.5 py-0 text-[10px] text-destructive'>
        <AlertCircle className='h-3 w-3' />
        {t('card.draftStatus.error')}
      </Badge>
    ) : (
      <Badge variant='outline' className='shrink-0 border-amber-500/30 px-1.5 py-0 text-[10px] text-amber-800 dark:text-amber-200'>
        {t('card.draftStatus.idle')}
      </Badge>
    );

  const actions = (
    <TooltipProvider>
      <div
        className={cn(
          'flex items-center gap-0.5 opacity-60 transition group-hover:opacity-100',
          view === 'list' && 'shrink-0',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <ActionButton
          label={t('card.continue')}
          onClick={() => navigate(`/conversation-v2/${app.sessionId}`)}
        >
          <MessageSquare className='h-3.5 w-3.5' />
        </ActionButton>
        <DeleteDraftAppButton sessionId={app.sessionId} />
      </div>
    </TooltipProvider>
  );

  const body = (
    <>
      <div className='flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-500/15'>
        <PencilLine className='h-4 w-4 text-amber-700 dark:text-amber-300' />
      </div>
      <div className='min-w-0 flex-1'>
        <div className='flex min-w-0 items-start gap-2'>
          <h3 className='min-w-0 flex-1 truncate text-sm font-medium leading-snug tracking-tight' title={title}>
            {title}
          </h3>
          <div className='flex shrink-0 items-center gap-1'>
            {app.hasAiFeatures ? <AppAiBadge /> : null}
            {statusBadge}
          </div>
        </div>
        <p className='mt-0.5 line-clamp-2 text-xs text-muted-foreground'>{t('card.draftHint')}</p>
        <p className='mt-0.5 text-[11px] text-muted-foreground'>
          {t('card.updatedAt', { date: new Date(app.lastUpdatedAt).toLocaleString() })}
        </p>
        <AppRevisionMeta revision={app} showDeployedRevision={false} />
      </div>
    </>
  );

  if (view === 'list') {
    return (
      <div className='group relative flex items-center gap-3 rounded-lg border border-amber-500/15 bg-card px-4 py-3 transition hover:border-amber-500/30 hover:bg-accent/30'>
        {body}
        {actions}
      </div>
    );
  }

  return (
    <div className='group relative flex h-full flex-col rounded-xl border border-amber-500/15 bg-gradient-to-br from-amber-500/[0.04] to-transparent bg-card p-5 transition hover:border-amber-500/30 hover:shadow-sm'>
      <div className='flex items-start gap-3'>{body}</div>
      <div className='-mx-5 -mb-5 mt-4 flex items-center justify-end border-t border-border/50 bg-accent/20 px-3 py-2'>
        {actions}
      </div>
    </div>
  );
});

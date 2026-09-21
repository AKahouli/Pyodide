import { memo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Layers, Loader2, MessageSquare, PencilLine } from 'lucide-react';
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
import {
  appCardBadgeClass,
  appCardIconClass,
  appCardSurfaceClass,
  type AppCardTone,
} from './app-card-tones';
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
          className='size-8 text-muted-foreground hover:text-foreground'
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

function draftTone(status: DraftApp['deployStatus']): AppCardTone {
  if (status === 'error') return 'error';
  if (status === 'deploying') return 'busy';
  return 'draft';
}

export const DraftAppCard = memo(function DraftAppCard({
  app,
  view = 'grid',
}: DraftAppCardProps) {
  const { t } = useModuleTranslation('app-builder');
  const navigate = useNavigate();
  const title = app.title || t('card.untitled');
  const tone = draftTone(app.deployStatus);
  const versionCount = app.finalizedVersionCount ?? 0;

  const statusBadge =
    app.deployStatus === 'deploying' ? (
      <Badge variant='outline' className={cn(appCardBadgeClass('busy'), 'normal-case tracking-normal')}>
        <Loader2 className='size-3 animate-spin' aria-hidden />
        {t('card.draftStatus.deploying')}
      </Badge>
    ) : app.deployStatus === 'error' ? (
      <Badge variant='outline' className={cn(appCardBadgeClass('error'), 'normal-case tracking-normal')}>
        <AlertCircle className='size-3' aria-hidden />
        {t('card.draftStatus.error')}
      </Badge>
    ) : (
      <Badge variant='outline' className={appCardBadgeClass('draft')}>
        {t('card.draftStatus.idle')}
      </Badge>
    );

  const featureChips = (
    <div className='mt-2.5 flex flex-wrap items-center gap-1.5'>
      <Badge
        variant='secondary'
        className='h-5 gap-1 border-0 bg-muted/70 px-2 text-[10px] font-medium text-muted-foreground'
      >
        {t('card.category.draft')}
      </Badge>
      {app.hasAiFeatures ? <AppAiBadge /> : null}
      {versionCount > 0 ? (
        <Badge
          variant='secondary'
          className='h-5 gap-1 border-0 bg-muted/70 px-2 text-[10px] font-medium text-muted-foreground'
        >
          <Layers className='size-2.5' aria-hidden />
          {t('card.versionsCount', { count: versionCount })}
        </Badge>
      ) : null}
    </div>
  );

  const actions = (
    <TooltipProvider>
      <div
        className={cn(
          'flex items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100',
          view === 'list' && 'shrink-0',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <ActionButton
          label={t('card.continue')}
          onClick={() => navigate(`/conversation-v2/${app.sessionId}`)}
        >
          <MessageSquare className='size-3.5' />
        </ActionButton>
        <DeleteDraftAppButton sessionId={app.sessionId} />
      </div>
    </TooltipProvider>
  );

  const body = (
    <>
      <div className={appCardIconClass(tone)}>
        <PencilLine className='size-5' aria-hidden />
      </div>
      <div className='min-w-0 flex-1'>
        <div className='flex min-w-0 items-start gap-2'>
          <h3
            className='min-w-0 flex-1 truncate text-base font-semibold leading-snug tracking-tight text-foreground'
            title={title}
          >
            {title}
          </h3>
          {statusBadge}
        </div>
        <p className='mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground'>
          {t('card.draftHint')}
        </p>
        <p className='mt-1.5 text-[11px] tabular-nums text-muted-foreground'>
          {t('card.updatedAt', { date: new Date(app.lastUpdatedAt).toLocaleString() })}
        </p>
        {featureChips}
        <AppRevisionMeta revision={app} showDeployedRevision={false} />
      </div>
    </>
  );

  if (view === 'list') {
    return <div className={appCardSurfaceClass(tone, 'list')}>{body}{actions}</div>;
  }

  return (
    <div className={appCardSurfaceClass(tone, 'grid')}>
      <div className='flex flex-1 items-start gap-3.5 p-5 pb-4'>{body}</div>
      <div className='mt-auto flex items-center justify-between gap-2 border-t border-border/50 bg-muted/20 px-3 py-2.5'>
        <span className='truncate text-[11px] text-muted-foreground'>{t('card.continueHint')}</span>
        {actions}
      </div>
    </div>
  );
});

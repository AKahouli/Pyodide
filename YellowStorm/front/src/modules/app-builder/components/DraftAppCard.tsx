import { memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Loader2, MessageSquare, PencilLine } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useModuleTranslation } from '@/modules/localization';
import type { AppViewMode } from '../hooks/useAppBuilderFilters';
import type { DraftApp } from '../types';

interface DraftAppCardProps {
  app: DraftApp;
  view?: AppViewMode;
}

export const DraftAppCard = memo(function DraftAppCard({
  app,
  view = 'list',
}: DraftAppCardProps) {
  const { t } = useModuleTranslation('app-builder');
  const navigate = useNavigate();
  const title = app.title || t('card.untitled');

  const statusBadge =
    app.deployStatus === 'deploying' ? (
      <Badge variant='outline' className='shrink-0 gap-1 border-amber-500/30 text-amber-700 dark:text-amber-300'>
        <Loader2 className='h-3 w-3 animate-spin' />
        {t('card.draftStatus.deploying')}
      </Badge>
    ) : app.deployStatus === 'error' ? (
      <Badge variant='outline' className='shrink-0 gap-1 border-destructive/40 text-destructive'>
        <AlertCircle className='h-3 w-3' />
        {t('card.draftStatus.error')}
      </Badge>
    ) : (
      <Badge variant='outline' className='shrink-0 border-amber-500/30 text-amber-800 dark:text-amber-200'>
        {t('card.draftStatus.idle')}
      </Badge>
    );

  const actions = (
    <TooltipProvider>
      <div className='flex shrink-0 items-center gap-1'>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label={t('card.continue')}
              onClick={() => navigate(`/conversation-v2/${app.sessionId}`)}
            >
              <MessageSquare className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('card.continue')}</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );

  return (
    <Card className='overflow-hidden border-amber-500/15 bg-gradient-to-br from-amber-500/[0.04] to-transparent'>
      <CardContent
        className={
          view === 'grid'
            ? 'flex h-full flex-col gap-4 p-4'
            : 'flex items-center gap-4 p-4'
        }
      >
        <div
          className={
            view === 'grid'
              ? 'flex items-start justify-between gap-3'
              : 'flex min-w-0 flex-1 items-center gap-4'
          }
        >
          <div className='flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-amber-500/15'>
            <PencilLine className='h-6 w-6 text-amber-700 dark:text-amber-300' />
          </div>

          <div className='min-w-0 flex-1'>
            <div className='flex min-w-0 items-center gap-2'>
              <h3 className='min-w-0 flex-1 truncate font-medium' title={title}>
                {title}
              </h3>
              {statusBadge}
            </div>
            <p className='mt-0.5 text-sm text-muted-foreground'>{t('card.draftHint')}</p>
            <p className='mt-0.5 text-xs text-muted-foreground'>
              {t('card.updatedAt', { date: new Date(app.lastUpdatedAt).toLocaleString() })}
            </p>
          </div>

          {view === 'list' ? actions : null}
        </div>

        {view === 'grid' ? (
          <div className='mt-auto flex justify-end border-t border-border/60 pt-3'>
            {actions}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
});

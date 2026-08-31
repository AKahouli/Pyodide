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
    <Card className='overflow-hidden border-amber-500/15 bg-gradient-to-br from-amber-500/[0.04] to-transparent shadow-sm'>
      <CardContent className='flex items-start gap-2.5 p-3'>
        <div className='flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-500/15'>
          <PencilLine className='h-4 w-4 text-amber-700 dark:text-amber-300' />
        </div>

        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 items-start gap-2'>
            <h3 className='min-w-0 flex-1 truncate text-sm font-medium leading-snug' title={title}>
              {title}
            </h3>
            {statusBadge}
          </div>
          <p className='mt-0.5 line-clamp-2 text-xs text-muted-foreground'>{t('card.draftHint')}</p>
          <p className='mt-0.5 text-[11px] text-muted-foreground'>
            {t('card.updatedAt', { date: new Date(app.lastUpdatedAt).toLocaleString() })}
          </p>
        </div>

        <div className={view === 'grid' ? 'shrink-0 self-start' : 'shrink-0'}>{actions}</div>
      </CardContent>
    </Card>
  );
});

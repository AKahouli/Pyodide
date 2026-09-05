import { useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Check, Copy, Eye, Link2, Loader2, MoreHorizontal, Pencil, Trash2, Star } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { API_CONFIG, API_ENDPOINTS } from '@/lib/api/config';
import type { PlaybookSummary } from '../types';
import { useModuleTranslation } from '@/modules/localization';
import { PlaybookScheduleBadge } from './schedule/PlaybookScheduleBadge';
import { PlaybookStatusBadge } from './PlaybookStatusBadge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

type Props = Readonly<{
  playbook: PlaybookSummary;
  onDelete: (id: string) => void;
  onClone: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onEditDetails?: (id: string) => void;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (id: string, selected: boolean) => void;
}>;

export function PlaybookCard({ playbook, onDelete, onClone, onToggleFavorite, onEditDetails, selectable, selected, onSelect }: Props) {
  const navigate = useNavigate();
  const [copyingIntegrationLink, setCopyingIntegrationLink] = useState(false);
  const [integrationLinkCopied, setIntegrationLinkCopied] = useState(false);
  const [integrationLinkOpen, setIntegrationLinkOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const { t } = useModuleTranslation('playbook');

  const updatedAt = new Date(playbook.updatedAt).toLocaleDateString();
  const integrationLink = playbook.integrationToken
    ? `${API_CONFIG.baseURL}${API_ENDPOINTS.playbooks.publicExecute(playbook.integrationToken)}`
    : '';
  const hasExecutionStatus = Boolean(playbook.executionStatus);
  const openPlaybook = (search = '') => {
    navigate(`/playbooks/${playbook.id}${search}`, { state: { autoLayoutOnOpen: true } });
  };

  const handleCopyIntegrationLink = async (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();

    try {
      setCopyingIntegrationLink(true);
      if (!integrationLink) {
        throw new Error('Missing integration token');
      }

      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard unavailable');
      }

      await navigator.clipboard.writeText(integrationLink);
      setIntegrationLinkCopied(true);
      toast.success(t('card.integration.copied'));
      window.setTimeout(() => setIntegrationLinkCopied(false), 2000);
    } catch {
      toast.error(t('card.integration.copyError'));
    } finally {
      setCopyingIntegrationLink(false);
    }
  };

  return (
    <Card
      className={`${selectable ? 'cursor-pointer' : ''} transition-colors hover:border-primary/50 ${selected ? 'border-primary ring-1 ring-primary/30' : ''}`}
      onClick={selectable && onSelect ? () => onSelect(playbook.id, !selected) : undefined}>
      <CardHeader className='pb-2'>
        <div className='flex items-start justify-between gap-3'>
          <div className='flex items-start gap-2 min-w-0 flex-1'>
            {selectable && <Checkbox aria-label={t('card.select', { name: playbook.name })} checked={selected} onCheckedChange={(checked) => onSelect?.(playbook.id, checked === true)} onClick={(e) => e.stopPropagation()} className='mt-0.5 shrink-0' />}
            <div className='min-w-0 flex-1'>
              <div className='flex min-w-0 items-center gap-1.5'>
                <CardTitle className='text-base line-clamp-2' title={playbook.name}>{playbook.name}</CardTitle>
                {playbook.scheduleEnabled ? (
                  playbook.executionSchedule ? (
                    <PlaybookScheduleBadge schedule={playbook.executionSchedule} className="shrink-0" />
                  ) : (
                    <span className='inline-flex shrink-0' title={t('card.scheduled')}>
                      <CalendarClock
                        className='h-3.5 w-3.5 text-muted-foreground'
                        aria-hidden
                      />
                    </span>
                  )
                ) : null}
              </div>
              {playbook.description && <CardDescription className='line-clamp-2 text-xs'>{playbook.description}</CardDescription>}
            </div>
          </div>
          <div className='flex items-center gap-1.5 shrink-0'>
            <PlaybookStatusBadge status={playbook.executionStatus ?? 'idle'} size='xs' />
          </div>
        </div>
      </CardHeader>
      <CardContent className='pb-2'>
        <p className='text-xs text-muted-foreground'>
          {t('card.taskCount', { count: playbook.taskCount })} &middot; {t('card.updated', { date: updatedAt })}
        </p>
      </CardContent>
      <CardFooter className='justify-between gap-2 pt-0'>
        <Button
          variant='secondary'
          size='sm'
          className='min-h-10 flex-1'
          onClick={(event) => {
            event.stopPropagation();
            openPlaybook();
          }}>
          <Eye className='mr-2 h-4 w-4' />
          {t('card.view')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              className='h-10 w-10 shrink-0'
              onClick={(event) => event.stopPropagation()}
              aria-label={t('card.actions', { name: playbook.name })}>
              <MoreHorizontal className='h-4 w-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' onClick={(event) => event.stopPropagation()}>
            <DropdownMenuItem onSelect={() => openPlaybook('?triggers=1')}>
              <CalendarClock className='mr-2 h-4 w-4' />
              {t('card.openTriggers')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setIntegrationLinkOpen(true)}>
              <Link2 className='mr-2 h-4 w-4' />
              {t('card.integration.open')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onClone(playbook.id)}>
              <Copy className='mr-2 h-4 w-4' />
              {t('card.clone')}
            </DropdownMenuItem>
            {onEditDetails ? (
              <DropdownMenuItem onSelect={() => onEditDetails(playbook.id)}>
                <Pencil className='mr-2 h-4 w-4' />
                {t('card.edit')}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={() => onToggleFavorite(playbook.id)}>
              <Star className={`mr-2 h-4 w-4 ${playbook.isFavorite ? 'fill-yellow-400 text-yellow-400' : ''}`} />
              {t(playbook.isFavorite ? 'card.unfavorite' : 'card.favorite')}
            </DropdownMenuItem>
            <DropdownMenuItem className='text-destructive focus:text-destructive' onSelect={() => setDeleteConfirmOpen(true)}>
              <Trash2 className='mr-2 h-4 w-4' />
              {t('card.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Dialog open={integrationLinkOpen} onOpenChange={setIntegrationLinkOpen}>
          <DialogContent className='sm:max-w-md'>
            <DialogHeader>
              <DialogTitle>{t('card.integration.title')}</DialogTitle>
              <DialogDescription>{t('card.integration.description')}</DialogDescription>
            </DialogHeader>
            <div className='flex gap-2'>
              <Input value={integrationLink} readOnly className='font-mono text-xs' onClick={(e) => (e.currentTarget as HTMLInputElement).select()} />
              <Button
                type='button'
                onClick={handleCopyIntegrationLink}
                disabled={copyingIntegrationLink || !integrationLink}
                size='sm'
                className='shrink-0'>
                {copyingIntegrationLink ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : integrationLinkCopied ? (
                  <Check className='h-4 w-4 mr-1' />
                ) : (
                  <Copy className='h-4 w-4 mr-1' />
                )}
                {t('card.integration.copy')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <AlertDialogContent onClick={(event) => event.stopPropagation()}>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('card.deleteConfirm.title')}</AlertDialogTitle>
              <AlertDialogDescription>{t('card.deleteConfirm.description', { name: playbook.name })}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('card.deleteConfirm.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
                onClick={() => onDelete(playbook.id)}>
                {t('card.delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardFooter>
    </Card>
  );
}

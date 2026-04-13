import { useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Check, Copy, Eye, Link2, Loader2, Trash2, Star } from 'lucide-react';
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

type Props = Readonly<{
  playbook: PlaybookSummary;
  onDelete: (id: string) => void;
  onClone: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (id: string, selected: boolean) => void;
}>;

export function PlaybookCard({ playbook, onDelete, onClone, onToggleFavorite, selectable, selected, onSelect }: Props) {
  const navigate = useNavigate();
  const [copyingIntegrationLink, setCopyingIntegrationLink] = useState(false);
  const [integrationLinkCopied, setIntegrationLinkCopied] = useState(false);
  const [integrationLinkOpen, setIntegrationLinkOpen] = useState(false);
  const { t } = useModuleTranslation('playbook');

  const updatedAt = new Date(playbook.updatedAt).toLocaleDateString();
  const integrationLink = playbook.integrationToken
    ? `${API_CONFIG.baseURL}${API_ENDPOINTS.playbooks.publicExecute(playbook.integrationToken)}`
    : '';
  const hasExecutionStatus = Boolean(playbook.executionStatus);

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
      toast.success('Integration URL copied');
      window.setTimeout(() => setIntegrationLinkCopied(false), 2000);
    } catch {
      toast.error('Failed to copy integration URL');
    } finally {
      setCopyingIntegrationLink(false);
    }
  };

  return (
    <Card
      className={`cursor-pointer hover:border-primary/50 transition-colors ${selected ? 'border-primary ring-1 ring-primary/30' : ''}`}
      onClick={() => {
        if (selectable && onSelect) {
          onSelect(playbook.id, !selected);
        } else {
          navigate(`/playbooks/${playbook.id}`);
        }
      }}>
      <CardHeader className='pb-2'>
        <div className='flex items-start justify-between gap-3'>
          <div className='flex items-start gap-2 min-w-0 flex-1'>
            {selectable && <Checkbox checked={selected} onCheckedChange={(checked) => onSelect?.(playbook.id, checked === true)} onClick={(e) => e.stopPropagation()} className='mt-0.5 shrink-0' />}
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
            <Button
              variant='ghost'
              size='icon'
              className='h-7 w-7'
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/playbooks/${playbook.id}?schedule=1`);
              }}
              title='Open scheduler'
              aria-label='Open scheduler'>
              <CalendarClock className='h-3.5 w-3.5' />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className='pb-2'>
        <p className='text-xs text-muted-foreground'>
          {t('card.taskCount', { count: playbook.taskCount })} &middot; {t('card.updated', { date: updatedAt })}
        </p>
      </CardContent>
      <CardFooter className='gap-1 pt-0'>
        <Button
          variant='ghost'
          size='icon'
          className='h-7 w-7'
          onClick={(e) => {
            e.stopPropagation();
            setIntegrationLinkOpen(true);
          }}
          title='Copy integration URL'
          aria-label='Copy integration URL'>
          <Link2 className='h-3.5 w-3.5' />
        </Button>
        <Dialog open={integrationLinkOpen} onOpenChange={setIntegrationLinkOpen}>
          <DialogContent className='sm:max-w-md'>
            <DialogHeader>
              <DialogTitle>Integration URL</DialogTitle>
              <DialogDescription>Copy this URL to run the selected playbook from another application.</DialogDescription>
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
                Copy
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Button
          variant='ghost'
          size='icon'
          className='h-7 w-7'
          onClick={(e) => {
            e.stopPropagation();
            onClone(playbook.id);
          }}
          title='Clone playbook'>
          <Copy className='h-3.5 w-3.5' />
        </Button>
        <Button
          variant='ghost'
          size='icon'
          className='h-7 w-7'
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(playbook.id);
          }}
          title={t('card.favorite')}>
          <Star className={`h-3.5 w-3.5 ${playbook.isFavorite ? 'fill-yellow-400 text-yellow-400' : ''}`} />
        </Button>
        <Button
          variant='ghost'
          size='icon'
          className='h-7 w-7'
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/playbooks/${playbook.id}`);
          }}
          title={t('card.view')}>
          <Eye className='h-3.5 w-3.5' />
        </Button>
        <Button
          variant='ghost'
          size='icon'
          className='h-7 w-7 text-destructive hover:text-destructive'
          onClick={(e) => {
            e.stopPropagation();
            onDelete(playbook.id);
          }}
          title={t('card.delete')}>
          <Trash2 className='h-3.5 w-3.5' />
        </Button>
      </CardFooter>
    </Card>
  );
}

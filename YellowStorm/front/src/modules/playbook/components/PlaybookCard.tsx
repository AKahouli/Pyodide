import { useNavigate } from 'react-router-dom';
import { CalendarClock, Copy, Eye, Trash2, Star } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { PlaybookSummary } from '../types';
import { useModuleTranslation } from '@/modules/localization';

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
  const { t } = useModuleTranslation('playbook');

  const updatedAt = new Date(playbook.updatedAt).toLocaleDateString();

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
        <div className='flex items-start gap-2'>
          {selectable && <Checkbox checked={selected} onCheckedChange={(checked) => onSelect?.(playbook.id, checked === true)} onClick={(e) => e.stopPropagation()} className='mt-0.5 shrink-0' />}
          <div className='min-w-0 flex-1'>
            <div className='flex min-w-0 items-center gap-1.5'>
              <CardTitle className='text-base truncate'>{playbook.name}</CardTitle>
              {playbook.scheduleEnabled ? (
                <span className='inline-flex shrink-0' title={t('card.scheduled')}>
                  <CalendarClock
                    className='h-3.5 w-3.5 text-muted-foreground'
                    aria-hidden
                  />
                </span>
              ) : null}
            </div>
            {playbook.description && <CardDescription className='line-clamp-2 text-xs'>{playbook.description}</CardDescription>}
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

import { CheckCircle2, ChevronLeft, ChevronRight, ListChecks, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import type { ReviewQueueItem } from '../../types';
import { opensElsewhere, reviewFixText, reviewItemText } from './ReviewQueuePanel';

/**
 * Says what is being fixed while the Trust center is out of the way, and moves through the list without
 * going back to it: the previous or next item opens where it is fixed, and "Back to the list" returns.
 * Once the item leaves the list (it was fixed), the bar says so and offers the next one.
 */
export function ReviewFocusBar({ item, items, onOpen, onBack, onClose }: Readonly<{
  item: ReviewQueueItem;
  /** The current review list; the item is looked up in it to know whether it is still open. */
  items: ReviewQueueItem[];
  onOpen: (item: ReviewQueueItem) => void;
  onBack: () => void;
  onClose: () => void;
}>) {
  const { t } = useModuleTranslation('semantic-model');
  const translate = t as (key: string, options?: Record<string, unknown>) => string;
  const route = items.filter(opensElsewhere);
  const index = route.findIndex((candidate) => candidate.key === item.key);
  const fixed = index === -1;
  const previous = index > 0 ? route[index - 1] : undefined;
  const next = fixed ? route[0] : route[index + 1];
  return <div role='status' aria-live='polite' className='flex flex-wrap items-center gap-2 border-b bg-primary/5 px-3 py-2 text-sm'>
    {fixed ? <CheckCircle2 className='h-4 w-4 shrink-0 text-emerald-600' /> : <ListChecks className='h-4 w-4 shrink-0 text-primary' />}
    <p className='min-w-0 flex-1'>
      <span className='font-medium'>{fixed ? t('reviewFocus.fixed') : t('reviewFocus.fixing', { position: index + 1, total: route.length })}</span>
      <span className='ml-1.5 break-words text-muted-foreground'>{reviewItemText(item, translate)}</span>
      {!fixed && <span className='mt-0.5 block break-words text-xs'>{reviewFixText(item, translate)}</span>}
    </p>
    <div className='flex items-center gap-1'>
      {previous && <Button variant='ghost' size='sm' className='h-8 px-2' onClick={() => onOpen(previous)} aria-label={t('reviewFocus.previous')} title={reviewItemText(previous, translate)}><ChevronLeft className='h-4 w-4' /></Button>}
      {next && <Button variant='ghost' size='sm' className='h-8 px-2' onClick={() => onOpen(next)} title={reviewItemText(next, translate)}>{t('reviewFocus.next')}<ChevronRight className='ml-1 h-4 w-4' /></Button>}
      <Button variant='outline' size='sm' className='h-8' onClick={onBack}>{t('reviewFocus.back')}</Button>
      <Button variant='ghost' size='icon' className='h-8 w-8' onClick={onClose} aria-label={t('reviewFocus.close')}><X className='h-4 w-4' /></Button>
    </div>
  </div>;
}

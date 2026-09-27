import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { useReviewQueue } from '../../query/hooks';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import type { ReviewQueueItem } from '../../types';

export interface ReviewQueueHandlers {
  /** Opens the source mapping so it can be repaired. */
  onRepairMapping?: (mappingId: string) => void;
  /** Opens a concept (to choose its unique field) or a relationship (to set up how records link). */
  onOpenItem?: (id: string) => void;
  /** Goes to Explore data for that concept, where values can be fixed. */
  onFixValues?: (conceptId: string) => void;
}

const GROUPS: ReviewQueueItem['group'][] = ['sources', 'identity', 'decisions', 'links', 'data'];

/** Everything that needs a person, in one list: grouped, most important first, one action each. */
export function ReviewQueueList({ modelId, canEdit, onRepairMapping, onOpenItem, onFixValues }: Readonly<{ modelId: string; canEdit: boolean } & ReviewQueueHandlers>) {
  const { t } = useModuleTranslation('semantic-model');
  const translate = t as (key: string, options?: Record<string, unknown>) => string;
  const queue = useReviewQueue(modelId);
  const client = useQueryClient();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const resolve = useMutation({
    mutationFn: ({ reviewItemId, select, value }: { reviewItemId: string; select: 'target' | 'source'; value: string }) => semanticModelApi.resolveReviewItem(modelId, reviewItemId, {
      decision: 'accepted',
      ...(select === 'target' ? { selectedTargetId: value } : { selectedMappingId: value }),
    }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.reviewQueue(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.model(modelId) }),
        client.invalidateQueries({ queryKey: semanticModelQueryKeys.readiness(modelId) }),
        client.invalidateQueries({ queryKey: ['semantic-models', 'review-items', modelId] }),
        client.invalidateQueries({ queryKey: ['semantic-models', 'data-preview', modelId] }),
      ]);
      showSuccess(t('trust.reviewResolved'));
    },
    onError: () => showError(t('trust.reviewError')),
  });

  if (queue.isLoading) return <p className='mt-3 flex items-center gap-2 text-sm text-muted-foreground'><Loader2 className='h-4 w-4 animate-spin' />{t('reviewQueue.loading')}</p>;
  if (queue.isError) return <p className='mt-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground'>{t('reviewQueue.unavailable')}</p>;
  const items = queue.data?.items ?? [];
  if (!items.length) return <p className='mt-3 flex items-center gap-2 rounded-xl border border-dashed p-4 text-sm text-muted-foreground'><CheckCircle2 className='h-4 w-4 text-emerald-600' />{t('reviewQueue.empty')}</p>;

  const actionButton = (item: ReviewQueueItem) => {
    const action = item.action;
    if (!canEdit) return null;
    if (action.kind === 'choose_match') {
      const value = choices[item.key] ?? '';
      const pending = resolve.isPending && resolve.variables?.reviewItemId === action.reviewItemId;
      return <div className='mt-2 flex flex-wrap items-center gap-2'>
        <select className='h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs' value={value} onChange={(event) => setChoices((current) => ({ ...current, [item.key]: event.target.value }))} aria-label={t(action.select === 'target' ? 'reviewQueue.chooseRecord' : 'reviewQueue.chooseSource')}>
          <option value=''>{t(action.select === 'target' ? 'reviewQueue.chooseRecord' : 'reviewQueue.chooseSource')}</option>
          {action.options.map((option, index) => <option key={option.value} value={option.value}>{option.label || t('reviewQueue.optionNumber', { number: index + 1 })}</option>)}
        </select>
        <Button size='sm' className='h-8' disabled={!value || pending} onClick={() => resolve.mutate({ reviewItemId: action.reviewItemId, select: action.select, value })}>{pending && <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />}{t('reviewQueue.action.choose_match')}</Button>
      </div>;
    }
    const run = () => {
      if (action.kind === 'repair_mapping') onRepairMapping?.(action.mappingId);
      else if (action.kind === 'choose_unique_field') onOpenItem?.(action.conceptId);
      else if (action.kind === 'set_up_link') onOpenItem?.(action.relationId);
      else onFixValues?.(action.conceptId);
    };
    return <Button size='sm' variant='outline' className='mt-2 h-8' onClick={run}>{translate(`reviewQueue.action.${action.kind}`)}</Button>;
  };

  return <div className='mt-3 space-y-4'>
    {GROUPS.map((group) => {
      const inGroup = items.filter((item) => item.group === group);
      if (!inGroup.length) return null;
      return <section key={group} aria-label={translate(`reviewQueue.group.${group}`)}>
        <h4 className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>{translate(`reviewQueue.group.${group}`)} · {inGroup.length}</h4>
        <ul className='mt-2 space-y-2'>{inGroup.map((item) => <li key={item.key} className='rounded-xl border p-3'>
          <div className='flex items-start gap-2'>
            {item.priority === 1 ? <AlertOctagon className='mt-0.5 h-4 w-4 shrink-0 text-destructive' aria-label={t('reviewQueue.priority.high')} />
              : item.priority === 2 ? <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0 text-amber-600' aria-label={t('reviewQueue.priority.medium')} />
                : <Info className='mt-0.5 h-4 w-4 shrink-0 text-muted-foreground' aria-label={t('reviewQueue.priority.low')} />}
            <div className='min-w-0 flex-1'>
              <p className='break-words text-sm'>{translate(`reviewQueue.kind.${item.kind}`, readableParams(item.params))}</p>
              <p className='mt-0.5 text-xs text-muted-foreground'>{translate(`reviewQueue.why.${item.kind}`)}</p>
              {actionButton(item)}
            </div>
          </div>
        </li>)}</ul>
      </section>;
    })}
  </div>;
}

/** Field keys such as "legal_name" read as "Legal name". */
function readableParams(params: Record<string, string | number>) {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, typeof value === 'string' && /^[a-z0-9]+(_[a-z0-9]+)+$/.test(value)
    ? value.replaceAll('_', ' ').replace(/^./, (first) => first.toLocaleUpperCase()) : value]));
}

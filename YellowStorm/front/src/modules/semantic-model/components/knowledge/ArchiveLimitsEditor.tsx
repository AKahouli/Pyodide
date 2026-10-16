import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../../api';
import { semanticModelQueryKeys } from '../../query/queryKeys';
import type { ArchiveReadLimits, DataConnection } from '../../types';
import { FormField, INPUT } from '../form/FormParts';

type LimitKey = keyof ArchiveReadLimits;
type Ceilings = DataConnection['ceilings'];

/** The ranges the back end and the runtime accept; read time and memory also stop at the admin's value. */
const FIELDS: ReadonlyArray<{ key: LimitKey; min: number; max: number }> = [
  { key: 'maxArchiveEmails', min: 100, max: 200000 },
  { key: 'maxArchiveMb', min: 10, max: 51200 },
  { key: 'archiveTimeoutSeconds', min: 60, max: 7200 },
  { key: 'parserMemoryMb', min: 256, max: 16384 },
];
const BUILT_IN = { maxArchiveEmails: 50000, maxArchiveMb: 1024 };

const ceilingOf = (key: LimitKey, ceilings: Ceilings) => key === 'archiveTimeoutSeconds' || key === 'parserMemoryMb' ? ceilings[key] : undefined;
const defaultOf = (key: LimitKey, ceilings: Ceilings) => ceilingOf(key, ceilings) ?? BUILT_IN[key as keyof typeof BUILT_IN];

function invalid(key: LimitKey, value: number | undefined, ceilings: Ceilings): boolean {
  const field = FIELDS.find((candidate) => candidate.key === key)!;
  const max = Math.min(field.max, ceilingOf(key, ceilings) ?? field.max);
  return value !== undefined && (!Number.isInteger(value) || value < field.min || value > max);
}

/** One line per connection: what each limit is now, the connection's value or its default. */
export function useArchiveLimitsSummary(): (connection: Pick<DataConnection, 'limits' | 'ceilings'>) => string {
  const { t } = useModuleTranslation('semantic-model');
  return (connection) => FIELDS.map(({ key }) => `${t(`settings.runLimits.${key}`)} ${(connection.limits[key] ?? defaultOf(key, connection.ceilings)).toLocaleString()}`).join(' · ');
}

/**
 * How much of a mail archive a run reads: e-mails, size, and the reader's time and memory, which an
 * admin caps. Saved on the connection, so every mapping of the archive reads it the same way.
 */
export function ArchiveLimitsEditor({ modelId, connection, canEdit }: Readonly<{ modelId: string; connection: DataConnection; canEdit: boolean }>) {
  const { t } = useModuleTranslation('semantic-model');
  const client = useQueryClient();
  const [draft, setDraft] = useState<ArchiveReadLimits>(connection.limits);
  useEffect(() => setDraft(connection.limits), [connection.limits]);
  const save = useMutation({
    mutationFn: (limits: ArchiveReadLimits) => semanticModelApi.updateDataConnection(modelId, connection.id, { limits }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: semanticModelQueryKeys.dataConnections(modelId) }); showSuccess(t('dataSources.limits.saved')); },
    onError: (error) => showError(t('dataSources.limits.error'), { description: parseApiError(error).message }),
  });
  const hasProblem = FIELDS.some(({ key }) => invalid(key, draft[key], connection.ceilings));
  const changed = FIELDS.some(({ key }) => draft[key] !== connection.limits[key]);

  return <div className='space-y-3'>
    <div className='grid gap-x-4 gap-y-3 sm:grid-cols-2'>
      {FIELDS.map(({ key, min, max }) => {
        const value = draft[key];
        const ceiling = ceilingOf(key, connection.ceilings);
        const wrong = invalid(key, value, connection.ceilings);
        const id = `archive-limit-${connection.id}-${key}`;
        return <FormField key={key} label={t(`settings.runLimits.${key}`)} help={t(`settings.runLimits.${key}Tip`)} htmlFor={id}>
          <Input id={id} type='number' min={min} max={ceiling ?? max} className={INPUT} aria-invalid={wrong} disabled={!canEdit}
            value={value ?? ''} placeholder={String(defaultOf(key, connection.ceilings))}
            onChange={(event) => {
              const next = { ...draft };
              if (event.target.value === '') delete next[key]; else next[key] = Number(event.target.value);
              setDraft(next);
            }} />
          <p className={cn('text-[11px]', wrong ? 'text-destructive' : 'text-muted-foreground')}>
            {wrong ? t('mapping.ai.range', { min: min.toLocaleString(), max: (ceiling ?? max).toLocaleString() })
              : ceiling !== undefined ? t('dataSources.limits.ceiling', { value: ceiling.toLocaleString() })
                : t('settings.builtIn', { value: defaultOf(key, connection.ceilings).toLocaleString() })}
          </p>
        </FormField>;
      })}
    </div>
    <p className='text-xs text-muted-foreground'>{t('dataSources.limits.note')}</p>
    {canEdit && <div className='flex flex-wrap items-center gap-2'>
      <Button size='sm' className='bg-foreground text-background hover:bg-foreground/90' disabled={!changed || hasProblem || save.isPending} onClick={() => save.mutate(draft)}>
        {save.isPending ? t('settings.saving') : t('settings.save')}
      </Button>
      {Object.keys(draft).length > 0 && <Button size='sm' variant='ghost' onClick={() => setDraft({})}>{t('settings.reset')}</Button>}
    </div>}
  </div>;
}

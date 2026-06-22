import { useState } from 'react';
import { useStream } from '../query/hooks';
import { useModuleTranslation } from '@/modules/localization';
import { StatusBadge } from './StatusBadge';

interface StreamHeaderProps {
  streamId: string;
  onRename?: (title: string) => void;
}

export function StreamHeader({ streamId, onRename }: StreamHeaderProps): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const { data: stream, isLoading, error } = useStream(streamId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  if (isLoading) {
    return <div className='px-4 py-3 text-sm text-muted-foreground'>{t('header.loading')}</div>;
  }
  if (error || !stream) {
    return <div className='px-4 py-3 text-sm text-destructive'>{t('header.error')}</div>;
  }

  const startEditing = () => {
    setDraft(stream.title);
    setEditing(true);
  };
  const commit = () => {
    if (draft && draft !== stream.title) onRename?.(draft);
    setEditing(false);
  };

  return (
    <header className='flex items-center justify-between gap-4 border-b border-border/60 bg-background/40 px-6 py-4'>
      <div className='flex flex-col gap-1'>
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
            className='rounded-md border border-border bg-background px-2 py-1 text-base font-semibold'
            data-testid='stream-title-input'
          />
        ) : (
          <button
            type='button'
            onClick={startEditing}
            className='text-left text-lg font-semibold leading-tight hover:underline'
            data-testid='stream-title'
          >
            {stream.title}
          </button>
        )}
        <div className='flex items-center gap-2 text-xs text-muted-foreground'>
          <span>{t('header.planVersion', { version: stream.currentPlanVersion })}</span>
          <span aria-hidden>·</span>
          <span>
            {t('header.budget', {
              limit: stream.budget.limitUsd,
              spent: stream.budget.spendUsd,
            })}
          </span>
        </div>
      </div>
      <div className='flex items-center gap-2'>
        <StatusBadge status={stream.status} />
        <StatusBadge status={stream.controlState} tone='control' />
      </div>
    </header>
  );
}

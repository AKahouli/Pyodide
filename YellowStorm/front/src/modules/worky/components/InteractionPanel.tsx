import { useState } from 'react';
import { useModuleTranslation } from '@/modules/localization';
import { Send, X } from 'lucide-react';
import { useWorkyPendingClarifications, useWorkyStore } from '../store';
import { useRespondInteraction } from '../query/hooks';
import { Button } from '@/components/ui/button';
import type { WorkyPendingClarification } from '../types';

interface InteractionPanelProps {
  streamId: string;
}

export function InteractionPanel({ streamId }: InteractionPanelProps): JSX.Element | null {
  const { t } = useModuleTranslation('worky');
  const clarifications = useWorkyPendingClarifications();
  const setPendingClarifications = useWorkyStore((s) => s.setPendingClarifications);
  const respond = useRespondInteraction(streamId);
  const [answer, setAnswer] = useState<Record<string, string>>({});

  if (clarifications.length === 0) return null;

  return (
    <aside
      className='flex flex-col gap-3 border-b border-border/60 bg-background/40 px-4 py-3'
      aria-label={t('interactions.heading')}
    >
      <h2 className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
        {t('interactions.heading')}
      </h2>
      {clarifications.map((c) => (
        <ClarificationRow
          key={c.id}
          clarification={c}
          value={answer[c.id] ?? ''}
          onChange={(v) => setAnswer((prev) => ({ ...prev, [c.id]: v }))}
          onSubmit={(content) => {
            respond.mutate(
              { interactionId: c.id, content },
              {
                onSuccess: () => {
                  setPendingClarifications(clarifications.filter((x) => x.id !== c.id));
                  setAnswer((prev) => {
                    const next = { ...prev };
                    delete next[c.id];
                    return next;
                  });
                },
              },
            );
          }}
          onCancel={() => {
            respond.mutate(
              { interactionId: c.id, content: '', cancel: true },
              {
                onSuccess: () => {
                  setPendingClarifications(clarifications.filter((x) => x.id !== c.id));
                },
              },
            );
          }}
          pending={respond.isPending}
        />
      ))}
    </aside>
  );
}

interface RowProps {
  clarification: WorkyPendingClarification;
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onCancel: () => void;
  pending: boolean;
}

function ClarificationRow({
  clarification,
  value,
  onChange,
  onSubmit,
  onCancel,
  pending,
}: RowProps): JSX.Element {
  const { t } = useModuleTranslation('worky');
  return (
    <form
      className='flex flex-col gap-2 rounded-md border border-border/60 bg-background/60 p-3'
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      <p className='text-sm'>{clarification.question}</p>
      {clarification.options.length > 0 ? (
        <div className='flex flex-wrap gap-2'>
          {clarification.options.map((opt) => (
            <button
              type='button'
              key={opt}
              onClick={() => onChange(opt)}
              className='rounded border border-border/60 px-2 py-1 text-xs hover:bg-muted/40'
            >
              {opt}
            </button>
          ))}
        </div>
      ) : null}
      <div className='flex items-center gap-2'>
        <input
          type='text'
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('interactions.placeholder')}
          className='min-h-[36px] flex-1 rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm placeholder:text-muted-foreground'
        />
        <Button type='submit' size='sm' disabled={pending || !value.trim()}>
          <Send className='mr-1 h-3 w-3' aria-hidden />
          {t('interactions.answer')}
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={onCancel}
          disabled={pending}
          aria-label={t('interactions.dismiss')}
        >
          <X className='h-3 w-3' aria-hidden />
        </Button>
      </div>
    </form>
  );
}

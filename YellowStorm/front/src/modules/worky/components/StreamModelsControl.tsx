import { WorkyModelSelector } from './WorkyModelSelector';
import { useUpdateStream } from '../query/hooks';
import type { WorkyStream } from '../types';
import { useModuleTranslation } from '@/modules/localization';

interface StreamModelsControlProps {
  stream: WorkyStream;
}

/**
 * Persistent manager / worker model selection for a Worky stream.
 * Rendered in the right-aside of `WorkyStreamPage` above
 * `BudgetControl`. The owner changes here are persisted via PATCH
 * `/worky/streams/{id}` and used as the next-turn fallback when
 * the prompt bar leaves its per-turn selectors on "Default".
 *
 * "Default" (the `null` pseudo-option) clears the stream's
 * persistent override so the runtime falls back to the admin
 * default at the next turn.
 */
export function StreamModelsControl({ stream }: StreamModelsControlProps): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const updateStream = useUpdateStream();

  const patchModel = (field: 'managerModelId' | 'workerModelId', next: string | null) => {
    if (updateStream.isPending) return;
    updateStream.mutate({
      streamId: stream.id,
      data: { [field]: next },
    });
  };

  return (
    <section
      data-testid='stream-models-control'
      className='rounded-md border border-border/60 bg-background/40 p-3 text-sm'
    >
      <header className='mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
        {t('stream.models.title')}
      </header>
      <div className='flex flex-col gap-2'>
        <WorkyModelSelector
          value={stream.managerModelId ?? null}
          label={t('stream.models.manager')}
          searchPlaceholder={t('promptBar.modelSelector.search')}
          defaultOptionLabel={t('promptBar.modelSelector.default')}
          emptyLabel={t('promptBar.modelSelector.empty')}
          disabled={updateStream.isPending}
          onChange={(next) => patchModel('managerModelId', next)}
        />
        <WorkyModelSelector
          value={stream.workerModelId ?? null}
          label={t('stream.models.workers')}
          searchPlaceholder={t('promptBar.modelSelector.search')}
          defaultOptionLabel={t('promptBar.modelSelector.default')}
          emptyLabel={t('promptBar.modelSelector.empty')}
          disabled={updateStream.isPending}
          onChange={(next) => patchModel('workerModelId', next)}
        />
      </div>
    </section>
  );
}

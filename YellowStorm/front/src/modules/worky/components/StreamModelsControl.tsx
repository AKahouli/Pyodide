import { useState } from 'react';
import { WorkyModelSelector } from './WorkyModelSelector';
import { useUpdateStream } from '../query/hooks';
import type { UpdateWorkyStreamData, WorkyStream } from '../types';
import { useModuleTranslation } from '@/modules/localization';

interface StreamModelsControlProps {
  stream: WorkyStream;
}

/**
 * Persistent per-stream agent configuration: Planner / Executor models and
 * system-prompt overrides. Rendered in the OrchestratorPanel Details tab.
 * Changes persist via PATCH `/worky/streams/{id}` and are sent to the worky
 * orchestrator on the next RunTask (`planner_model` / `executor_model` /
 * `planner_prompt` / `executor_prompt`).
 *
 * A model's "Default" (the `null` pseudo-option) clears the persistent override
 * so the runtime falls back to the admin default. An empty prompt clears to the
 * server default.
 */
export function StreamModelsControl({ stream }: StreamModelsControlProps): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const updateStream = useUpdateStream();

  const [plannerPrompt, setPlannerPrompt] = useState(stream.plannerPrompt ?? '');
  const [executorPrompt, setExecutorPrompt] = useState(stream.executorPrompt ?? '');

  const patch = (data: UpdateWorkyStreamData) => {
    if (updateStream.isPending) return;
    updateStream.mutate({ streamId: stream.id, data });
  };

  const commitPrompt = (
    field: 'plannerPrompt' | 'executorPrompt',
    value: string,
    persisted: string | null | undefined,
  ) => {
    const next = value.trim() ? value : null;
    if (next === (persisted ?? null)) return;
    patch({ [field]: next });
  };

  return (
    <section
      data-testid='stream-models-control'
      className='rounded-md border border-border/60 bg-background/40 p-3 text-sm'
    >
      <header className='mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
        {t('stream.settings.title')}
      </header>
      <div className='flex flex-col gap-3'>
        <div className='flex flex-col gap-2'>
          <WorkyModelSelector
            value={stream.plannerModelId ?? null}
            label={t('stream.models.planner')}
            searchPlaceholder={t('promptBar.modelSelector.search')}
            defaultOptionLabel={t('promptBar.modelSelector.default')}
            emptyLabel={t('promptBar.modelSelector.empty')}
            disabled={updateStream.isPending}
            onChange={(next) => patch({ plannerModelId: next })}
          />
          <WorkyModelSelector
            value={stream.executorModelId ?? null}
            label={t('stream.models.executor')}
            searchPlaceholder={t('promptBar.modelSelector.search')}
            defaultOptionLabel={t('promptBar.modelSelector.default')}
            emptyLabel={t('promptBar.modelSelector.empty')}
            disabled={updateStream.isPending}
            onChange={(next) => patch({ executorModelId: next })}
          />
        </div>
        <label className='flex flex-col gap-1'>
          <span className='text-xs font-medium text-muted-foreground'>
            {t('stream.prompts.planner')}
          </span>
          <textarea
            data-testid='stream-planner-prompt'
            className='min-h-[72px] resize-y rounded-md border border-border/60 bg-background/60 p-2 text-xs'
            maxLength={40000}
            placeholder={t('stream.prompts.plannerPlaceholder')}
            value={plannerPrompt}
            onChange={(e) => setPlannerPrompt(e.target.value)}
            onBlur={() => commitPrompt('plannerPrompt', plannerPrompt, stream.plannerPrompt)}
          />
        </label>
        <label className='flex flex-col gap-1'>
          <span className='text-xs font-medium text-muted-foreground'>
            {t('stream.prompts.executor')}
          </span>
          <textarea
            data-testid='stream-executor-prompt'
            className='min-h-[72px] resize-y rounded-md border border-border/60 bg-background/60 p-2 text-xs'
            maxLength={40000}
            placeholder={t('stream.prompts.executorPlaceholder')}
            value={executorPrompt}
            onChange={(e) => setExecutorPrompt(e.target.value)}
            onBlur={() => commitPrompt('executorPrompt', executorPrompt, stream.executorPrompt)}
          />
        </label>
      </div>
    </section>
  );
}

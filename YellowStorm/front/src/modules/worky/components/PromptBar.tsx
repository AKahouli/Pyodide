import { Send, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { useSendMessage } from '../query/hooks';
import { useWorkyStreaming } from '../store';
import { WorkyModelSelector } from './WorkyModelSelector';

interface PromptBarProps {
  streamId: string;
  /**
   * Per-stream persistent Manager model (LiteLLM identifier). The
   * prompt bar uses this to seed the local per-turn selector; the
   * owner can pick a different one for the next message without
   * touching the persistent field.
   */
  managerModelId?: string | null;
  /** Same as `managerModelId` but for ephemeral workers. */
  workerModelId?: string | null;
}

export function PromptBar({
  streamId,
  managerModelId,
  workerModelId,
}: PromptBarProps): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const [value, setValue] = useState('');
  const [managerModel, setManagerModel] = useState<string | null>(managerModelId ?? null);
  const [workerModel, setWorkerModel] = useState<string | null>(workerModelId ?? null);
  const send = useSendMessage(streamId);
  const streaming = useWorkyStreaming();
  // `null` is a valid per-turn value the user can set (the "Default"
  // pseudo-option), so we cannot use it as the "never seeded" sentinel.
  // Track the seed flag in a ref so the late-arriving stream data can
  // hydrate the per-turn selector exactly once, and user-driven picks
  // (including "Default") are preserved thereafter.
  const didSeedManager = useRef(managerModelId !== undefined);
  const didSeedWorker = useRef(workerModelId !== undefined);

  useEffect(() => {
    if (didSeedManager.current) return;
    if (managerModelId === undefined) return;
    // `null` is a legitimate stream value (owner cleared the persistent
    // override). Respect it as the seed and never auto-fall-back to
    // the admin default — the backend resolves the admin default when
    // no override reaches the runtime.
    didSeedManager.current = true;
    setManagerModel(managerModelId);
  }, [managerModelId]);
  useEffect(() => {
    if (didSeedWorker.current) return;
    if (workerModelId === undefined) return;
    didSeedWorker.current = true;
    setWorkerModel(workerModelId);
  }, [workerModelId]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const content = value.trim();
    if (!content || send.isPending) return;
    // Only attach an override when the local selection differs from
    // the persisted value — keeps the wire payload small and avoids
    // sending redundant data on every turn.
    const managerOverride = managerModel && managerModel !== managerModelId ? managerModel : undefined;
    const workerOverride = workerModel && workerModel !== workerModelId ? workerModel : undefined;
    send.mutate(
      { content, managerModelId: managerOverride, workerModelId: workerOverride },
      { onSuccess: () => setValue('') },
    );
  };

  return (
    <form
      className='flex items-center gap-2 border-t border-border/60 bg-background/40 px-4 py-3'
      onSubmit={submit}
    >
      <textarea
        id='worky-prompt-content'
        name='content'
        data-testid='worky-prompt-content'
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={t('promptBar.placeholder')}
        rows={1}
        disabled={send.isPending}
        className='min-h-[40px] flex-1 resize-none rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60'
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit(e);
          }
        }}
      />
      <WorkyModelSelector
        value={managerModel}
        label={t('promptBar.modelSelector.manager')}
        searchPlaceholder={t('promptBar.modelSelector.search')}
        defaultOptionLabel={t('promptBar.modelSelector.default')}
        emptyLabel={t('promptBar.modelSelector.empty')}
        disabled={send.isPending}
        onChange={setManagerModel}
      />
      <WorkyModelSelector
        value={workerModel}
        label={t('promptBar.modelSelector.workers')}
        searchPlaceholder={t('promptBar.modelSelector.search')}
        defaultOptionLabel={t('promptBar.modelSelector.default')}
        emptyLabel={t('promptBar.modelSelector.empty')}
        disabled={send.isPending}
        onChange={setWorkerModel}
      />
      <Button
        type='submit'
        size='icon'
        disabled={send.isPending || !value.trim()}
        aria-label={streaming ? t('promptBar.streaming') : t('promptBar.send')}
        data-testid='worky-prompt-send'
      >
        {streaming ? <Square className='h-4 w-4' /> : <Send className='h-4 w-4' />}
      </Button>
    </form>
  );
}

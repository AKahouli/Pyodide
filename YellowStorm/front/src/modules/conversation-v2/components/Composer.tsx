import { PauseIcon, PlayIcon, SquareIcon } from 'lucide-react';
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import { useConversationV2PointersStore, useConversationV2Store } from '../store';
import { useConversationV2Translation } from '../translation';

interface ComposerProps {
  onSend: (text: string) => void;
}

export function Composer({ onSend }: ComposerProps) {
  const streaming = useConversationV2Store((s) => s.streaming);
  const sessionId = useConversationV2Store((s) => s.sessionId);
  const stop = useConversationV2Store((s) => s.stop);
  const pause = useConversationV2Store((s) => s.pause);
  const resume = useConversationV2Store((s) => s.resume);
  const pointerStatus = useConversationV2PointersStore((s) =>
    sessionId ? s.items.find((p) => p.sessionId === sessionId)?.status : undefined,
  );
  const { t } = useConversationV2Translation();

  const status: 'ready' | 'streaming' = streaming ? 'streaming' : 'ready';
  const isPaused = !streaming && pointerStatus === 'paused';

  const handleSubmit = (message: PromptInputMessage) => {
    const value = message.text?.trim() ?? '';
    if (!value || streaming) return;
    onSend(value);
  };

  return (
    <div className='shrink-0 z-10 border-t border-border/50 bg-background/80 p-4 backdrop-blur-xs'>
      <div className='mx-auto w-full max-w-3xl'>
        <PromptInputProvider>
          <PromptInput onSubmit={handleSubmit}>
            <PromptInputBody>
              <PromptInputTextarea placeholder={t('composer.placeholder')} disabled={streaming} />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools>
                {streaming && (
                  <PromptInputButton type='button' onClick={() => void pause()}>
                    <PauseIcon className='size-4' />
                    <span>{t('controls.pause')}</span>
                  </PromptInputButton>
                )}
                {streaming && (
                  <PromptInputButton type='button' onClick={() => void stop()}>
                    <SquareIcon className='size-4' />
                    <span>{t('controls.stop')}</span>
                  </PromptInputButton>
                )}
                {isPaused && (
                  <PromptInputButton type='button' onClick={() => void resume()}>
                    <PlayIcon className='size-4' />
                    <span>{t('controls.resume')}</span>
                  </PromptInputButton>
                )}
              </PromptInputTools>
              <PromptInputSubmit status={status} onStop={() => void stop()} />
            </PromptInputFooter>
          </PromptInput>
        </PromptInputProvider>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { CheckIcon, PauseIcon, PlayIcon, SquareIcon } from 'lucide-react';
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
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from '@/components/ai-elements/model-selector';
import { useChefs, useDefaultModel, useModels } from '@/modules/models';
import { useConversationV2PointersStore, useConversationV2Store } from '../store';
import { useConversationV2Translation } from '../translation';

interface ComposerProps {
  onSend: (text: string, model?: string) => void;
}

export function Composer({ onSend }: ComposerProps) {
  const streaming = useConversationV2Store((s) => s.streaming);
  const sessionId = useConversationV2Store((s) => s.sessionId);
  const stop = useConversationV2Store((s) => s.stop);
  const pause = useConversationV2Store((s) => s.pause);
  const resume = useConversationV2Store((s) => s.resume);
  const selectedModelId = useConversationV2Store((s) => s.selectedModelId);
  const setSelectedModelId = useConversationV2Store((s) => s.setSelectedModelId);
  const pointerStatus = useConversationV2PointersStore((s) =>
    sessionId ? s.items.find((p) => p.sessionId === sessionId)?.status : undefined,
  );
  const { t } = useConversationV2Translation();

  const models = useModels();
  const chefs = useChefs();
  const defaultModel = useDefaultModel();
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false);

  // selectedModelId is null for fresh conversations → fall through to the
  // admin default. Both for the trigger label and for what we send on the
  // wire. (The wire payload is the LiteLLM identifier, not the modelId.)
  const activeModel =
    (selectedModelId && models.find((m) => m.id === selectedModelId)) || defaultModel || null;

  const status: 'ready' | 'streaming' = streaming ? 'streaming' : 'ready';
  const isPaused = !streaming && pointerStatus === 'paused';

  const handleSubmit = (message: PromptInputMessage) => {
    const value = message.text?.trim() ?? '';
    if (!value || streaming) return;
    onSend(value, activeModel?.litellmModel || undefined);
  };

  const handlePickModel = (modelId: string) => {
    setSelectedModelId(modelId);
    setModelSelectorOpen(false);
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
                {models.length > 0 && (
                  <ModelSelector open={modelSelectorOpen} onOpenChange={setModelSelectorOpen}>
                    <ModelSelectorTrigger asChild>
                      <PromptInputButton type='button' disabled={streaming}>
                        {activeModel?.chefSlug && (
                          <ModelSelectorLogo provider={activeModel.chefSlug} />
                        )}
                        <ModelSelectorName>
                          {activeModel?.name ?? t('composer.modelSelector.unset')}
                        </ModelSelectorName>
                      </PromptInputButton>
                    </ModelSelectorTrigger>
                    <ModelSelectorContent>
                      <ModelSelectorInput placeholder={t('composer.modelSelector.search')} />
                      <ModelSelectorList>
                        <ModelSelectorEmpty>
                          {t('composer.modelSelector.empty')}
                        </ModelSelectorEmpty>
                        {chefs.map((chef) => (
                          <ModelSelectorGroup heading={chef.name} key={chef.slug}>
                            {models
                              .filter((m) => m.chefSlug === chef.slug)
                              .map((m) => (
                                <ModelSelectorItem
                                  key={m.id}
                                  value={`${m.name} ${m.chef}`}
                                  onSelect={() => handlePickModel(m.id)}
                                >
                                  <ModelSelectorLogo provider={m.chefSlug} />
                                  <ModelSelectorName>{m.name}</ModelSelectorName>
                                  {activeModel?.id === m.id && (
                                    <CheckIcon className='ml-auto size-4 text-muted-foreground' />
                                  )}
                                </ModelSelectorItem>
                              ))}
                          </ModelSelectorGroup>
                        ))}
                      </ModelSelectorList>
                    </ModelSelectorContent>
                  </ModelSelector>
                )}
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

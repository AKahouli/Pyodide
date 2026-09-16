import { CheckIcon } from 'lucide-react';
import { useState } from 'react';
import { useModuleTranslation } from '@/modules/localization';
import type { Model } from '@/modules/models/types';
import { PromptInputButton } from './prompt-input';
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorLogoGroup,
  ModelSelectorName,
  ModelSelectorTrigger,
} from './model-selector';
import { Slider } from '@/components/ui/slider';

interface ModelReasoningSelectorProps {
  models: Model[];
  chefs: Array<{ slug: string; name: string }>;
  model?: Model;
  reasoningEffort?: string | null;
  showReasoningEffort?: boolean;
  disabled?: boolean;
  onModelChange: (modelId: string) => void;
  onReasoningEffortChange: (effort: string | null) => void;
}

export function ModelReasoningSelector({
  models,
  chefs,
  model,
  reasoningEffort,
  showReasoningEffort = true,
  disabled,
  onModelChange,
  onReasoningEffortChange,
}: ModelReasoningSelectorProps) {
  const { t } = useModuleTranslation('conversation');
  const [open, setOpen] = useState(false);
  const efforts = showReasoningEffort && model?.supportsReasoning ? (model.reasoning?.efforts ?? []) : [];
  const effectiveEffort = efforts.some((effort) => effort.id === reasoningEffort)
    ? reasoningEffort
    : model?.reasoning?.defaultEffort;
  const effortOptions = efforts.length === 0 || model?.reasoning?.defaultEffort
    ? efforts
    : [{ id: null, name: t('input.reasoning.default') }, ...efforts];
  const effortIndex = Math.max(0, effortOptions.findIndex((effort) => effort.id === effectiveEffort));
  const effort = effortOptions[effortIndex];

  return (
    <ModelSelector onOpenChange={setOpen} open={open}>
      <ModelSelectorTrigger asChild>
        <PromptInputButton type='button' disabled={disabled}>
          {model?.chefSlug && <ModelSelectorLogo provider={model.chefSlug} />}
          <ModelSelectorName>{model?.name ?? t('newConversation.modelSelector.unset')}</ModelSelectorName>
          {effort && <span className='text-muted-foreground'>· {effort.name}</span>}
        </PromptInputButton>
      </ModelSelectorTrigger>
      <ModelSelectorContent>
        {efforts.length > 0 && (
          <div className='border-b px-5 py-4'>
            <div className='mb-3 flex items-center justify-between gap-3 text-sm'>
              <span className='font-medium'>{t('input.reasoning.label')}</span>
              <span className='text-muted-foreground'>{effort?.name}</span>
            </div>
            <div className='relative flex h-8 items-center'>
              <div className='pointer-events-none absolute inset-x-0 z-10 flex justify-between px-0.5' aria-hidden='true'>
                {effortOptions.map((option, index) => (
                  <span key={option.id ?? '__default__'} className={`size-1.5 rounded-full ${index <= effortIndex ? 'bg-primary-foreground/70' : 'bg-muted-foreground/60'}`} />
                ))}
              </div>
              <Slider
                aria-label={t('input.reasoning.label')}
                aria-valuetext={effort?.name}
                className='[&_[data-slot=slider-thumb]]:z-20 [&_[data-slot=slider-thumb]]:size-7 [&_[data-slot=slider-track]]:h-3'
                min={0}
                max={effortOptions.length - 1}
                step={1}
                value={[effortIndex]}
                onValueChange={([index]) => onReasoningEffortChange(effortOptions[index].id)}
              />
            </div>
          </div>
        )}
        <ModelSelectorInput placeholder={t('newConversation.modelSelector.search')} />
        <ModelSelectorList>
          <ModelSelectorEmpty>{t('newConversation.modelSelector.empty')}</ModelSelectorEmpty>
          {chefs.map((chef) => (
            <ModelSelectorGroup heading={chef.name} key={chef.slug}>
              {models.filter((candidate) => candidate.chefSlug === chef.slug).map((candidate) => (
                <ModelSelectorItem key={candidate.id} onSelect={() => onModelChange(candidate.id)} value={`${candidate.name} ${candidate.chef}`}>
                  <ModelSelectorLogo provider={candidate.chefSlug} />
                  <ModelSelectorName>{candidate.name}</ModelSelectorName>
                  <ModelSelectorLogoGroup>
                    {candidate.providers.map((provider) => <ModelSelectorLogo key={provider} provider={provider} />)}
                  </ModelSelectorLogoGroup>
                  {model?.id === candidate.id && <CheckIcon className='ml-auto size-4 text-muted-foreground' />}
                </ModelSelectorItem>
              ))}
            </ModelSelectorGroup>
          ))}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}

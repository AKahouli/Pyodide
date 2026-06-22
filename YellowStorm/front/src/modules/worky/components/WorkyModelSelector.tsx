import { CheckIcon, Loader2Icon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { useChefs, useModels, useModelsInitialized } from '@/modules/models';
import { cn } from '@/lib/utils';

export interface WorkyModelSelectorProps {
  /** LiteLLM model identifier currently selected, or null for the default pseudo-option. */
  value: string | null;
  /** Translated label rendered in the trigger button. */
  label: string;
  /** Translated placeholder for the search input. */
  searchPlaceholder: string;
  /** Translated label for the "Use default" pseudo-option (clears the selection). */
  defaultOptionLabel: string;
  /** Translated text shown when no models are loaded. */
  emptyLabel: string;
  /** Disable while a message is being sent. */
  disabled?: boolean;
  /** Fired with `null` (use default) or a concrete model id. */
  onChange(next: string | null): void;
}

/**
 * Derive a short display name from a LiteLLM identifier when the model
 * isn't in the local catalog yet (cold load, or the model was removed).
 * Examples:
 *   "azure/gpt-5.4-mini" -> "gpt-5.4-mini"
 *   "gpt-4o-mini"        -> "gpt-4o-mini"
 *   "claude-3-5-sonnet-20240620" -> "claude-3-5-sonnet-20240620"
 */
function shortNameFromLitellmId(litellmId: string): string {
  const slash = litellmId.lastIndexOf('/');
  return slash >= 0 ? litellmId.slice(slash + 1) : litellmId;
}

/**
 * Compact inline model selector for the Worky prompt bar. Designed to
 * live next to the send button and surface both the currently selected
 * model name and the chef provider logo. Mirrors the visual style of
 * the conversation-v2 `ModelSelector` pattern but is purpose-built for
 * the worky module (smaller footprint, dedicated `null`/default
 * pseudo-option, no extra hooks beyond `useModels`).
 */
export function WorkyModelSelector({
  value,
  label,
  searchPlaceholder,
  defaultOptionLabel,
  emptyLabel,
  disabled,
  onChange,
}: WorkyModelSelectorProps): JSX.Element {
  const { t } = useTranslation('worky');
  const models = useModels();
  const chefs = useChefs();
  const isInitialized = useModelsInitialized();
  const [open, setOpen] = useState(false);

  const selectedModel = useMemo(
    () => (value ? models.find((m) => m.litellmModel === value) ?? null : null),
    [value, models],
  );

  // Fall back to a short name derived from the litellm id when the
  // model isn't (yet) in the local catalog. This keeps the trigger
  // label honest on cold load, so the owner never sees "Default" when
  // an override is actually active.
  const triggerText = selectedModel?.name
    ?? (value ? shortNameFromLitellmId(value) : defaultOptionLabel);
  const showCheckOnDefault = value === null;

  const handleSelect = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <ModelSelector open={open} onOpenChange={setOpen}>
      <ModelSelectorTrigger asChild>
        <button
          type='button'
          disabled={disabled}
          aria-label={`${label}: ${triggerText}`}
          data-testid={`worky-model-selector-${label.toLowerCase()}`}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2.5 text-xs',
            'hover:bg-background/80 disabled:cursor-not-allowed disabled:opacity-60',
          )}
        >
          {selectedModel?.chefSlug ? (
            <ModelSelectorLogo provider={selectedModel.chefSlug} />
          ) : null}
          <span className='font-medium text-muted-foreground'>{label}:</span>
          {!isInitialized ? (
            <Loader2Icon className='size-3 animate-spin text-muted-foreground' aria-hidden='true' />
          ) : null}
          <span className='max-w-[10rem] truncate'>{triggerText}</span>
        </button>
      </ModelSelectorTrigger>
      <ModelSelectorContent title={label}>
        <ModelSelectorInput placeholder={searchPlaceholder} />
        <ModelSelectorList>
          <ModelSelectorEmpty>{emptyLabel}</ModelSelectorEmpty>
          {/* "Use default" pseudo-option. Picking it clears the
              per-turn selection so the backend falls back to the
              stream field / admin default chain. */}
          <ModelSelectorGroup heading={t('promptBar.modelSelector.defaultGroup')}>
            <ModelSelectorItem
              value={defaultOptionLabel}
              onSelect={() => handleSelect(null)}
              data-testid={`worky-model-default-${label.toLowerCase()}`}
            >
              <ModelSelectorName>{defaultOptionLabel}</ModelSelectorName>
              {showCheckOnDefault ? (
                <CheckIcon className='ml-auto size-4 text-muted-foreground' />
              ) : null}
            </ModelSelectorItem>
          </ModelSelectorGroup>
          {chefs.map((chef) => (
            <ModelSelectorGroup heading={chef.name} key={chef.slug}>
              {models
                .filter((m) => m.chefSlug === chef.slug)
                .map((m) => (
                  <ModelSelectorItem
                    key={m.id}
                    value={`${m.name} ${m.chef}`}
                    onSelect={() => handleSelect(m.litellmModel)}
                    data-testid={`worky-model-option-${m.litellmModel}`}
                  >
                    <ModelSelectorLogo provider={m.chefSlug} />
                    <ModelSelectorName>{m.name}</ModelSelectorName>
                    {value === m.litellmModel ? (
                      <CheckIcon className='ml-auto size-4 text-muted-foreground' />
                    ) : null}
                  </ModelSelectorItem>
                ))}
            </ModelSelectorGroup>
          ))}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}

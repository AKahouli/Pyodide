import { Button } from '@/components/ui/button';
import { usePromptInputController } from '@/components/ai-elements/prompt-input';
import { useModuleTranslation } from '@/modules/localization';
import { Loader2 } from 'lucide-react';
import { useComposerSuggestions } from '../hooks/useComposerSuggestions';

export interface ComposerSuggestionChipsProps {
  /** When true, no network requests are made and chips are cleared. */
  fetchDisabled: boolean;
}

export function ComposerSuggestionChips({ fetchDisabled }: ComposerSuggestionChipsProps) {
  const { t } = useModuleTranslation('conversation');
  const { textInput } = usePromptInputController();
  const {  suggestion, loading, fetchError } = useComposerSuggestions({
    draftText: textInput.value,
    enabled: !fetchDisabled,
  });

  if (fetchDisabled) {
    return null;
  }

  const showBar = loading || fetchError || (suggestion !== null && suggestion.length > 0);

  if (!showBar) {
    return null;
  }

  return (
    <div
      aria-busy={loading}
      aria-label={t('composerSuggestions.barLabel')}
      className='flex flex-wrap items-center gap-2 px-0.5 pt-1'
      role='region'
    >
      {loading && (
        <span className='text-muted-foreground inline-flex items-center gap-1.5 text-xs'>
          <Loader2 aria-hidden className='size-3.5 animate-spin' />
          {t('composerSuggestions.loading')}
        </span>
      )}
      {fetchError && !loading && (
        <span className='text-muted-foreground text-xs'>{t('composerSuggestions.unavailable')}</span>
      )}
      {suggestion && suggestion.length > 0 && (
        <Button
          aria-label={t('composerSuggestions.applySuggestion', { suggestion })}
          className='h-auto max-w-full whitespace-normal px-2.5 py-1 text-left text-xs font-normal'
          onClick={() => textInput.setInput(suggestion)}
          type='button'
          variant='outline'
        >
          <span className='line-clamp-2'>{suggestion}</span>
        </Button>
      )}
    </div>
  );
}

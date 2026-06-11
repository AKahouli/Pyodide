import type { PlaybookIntentSuggestion } from '../types';

type TopIntentSuggestionOptions = {
  includeFallback?: boolean;
};

export const getTopIntentSuggestion = (
  suggestions: PlaybookIntentSuggestion[],
  options?: TopIntentSuggestionOptions,
): PlaybookIntentSuggestion | null => {
  const preferredSuggestions = suggestions.filter((suggestion) => !suggestion.isDirectIntentFallback);
  const candidateSuggestions = preferredSuggestions.length > 0
    ? preferredSuggestions
    : options?.includeFallback
      ? suggestions
      : preferredSuggestions;

  return candidateSuggestions.reduce<PlaybookIntentSuggestion | null>((best, suggestion) => {
    if (!best || suggestion.confidence > best.confidence) {
      return suggestion;
    }
    return best;
  }, null);
};

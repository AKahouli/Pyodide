import { useEffect, useRef, useState } from 'react';
import { fetchComposerSuggestions } from '../api';
import { parseComposerSuggestionsContent } from '../utils/parseComposerSuggestions';

const DEFAULT_DEBOUNCE_MS = 400;
const DEFAULT_MIN_LENGTH = 3;

/** apiClient rejects with `{ code, message, statusCode }` from the response interceptor. */
function httpStatusFromComposerError(err: unknown): number {
  if (
    typeof err === 'object' &&
    err !== null &&
    'statusCode' in err &&
    typeof (err as { statusCode: unknown }).statusCode === 'number'
  ) {
    return (err as { statusCode: number }).statusCode;
  }
  return 0;
}

export interface UseComposerSuggestionsOptions {
  draftText: string;
  enabled: boolean;
  debounceMs?: number;
  minLength?: number;
}

export function useComposerSuggestions({
  draftText,
  enabled,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  minLength = DEFAULT_MIN_LENGTH,
}: UseComposerSuggestionsOptions) {
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    abortRef.current?.abort();

    if (!enabled) {
      setSuggestions(null);
      setLoading(false);
      setFetchError(false);
      return;
    }

    const text = draftText.trim();
    if (text.length < minLength) {
      setSuggestions(null);
      setLoading(false);
      setFetchError(false);
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      const ac = new AbortController();
      abortRef.current = ac;
      setSuggestions(null);
      setLoading(true);
      setFetchError(false);

      fetchComposerSuggestions(text, ac.signal)
        .then(({ content }) => {
          if (ac.signal.aborted) return;
          const parsed = parseComposerSuggestionsContent(content);
          setSuggestions(parsed);
          setFetchError(parsed === null);
        })
        .catch((err) => {
          if (ac.signal.aborted) return;
          const statusCode = httpStatusFromComposerError(err);
          // Nest returns 502 when ADK is down or misconfigured; avoid noisy "unavailable" UX.
          if (statusCode === 502) {
            setSuggestions(null);
            setFetchError(false);
            return;
          }
          setSuggestions(null);
          setFetchError(true);
        })
        .finally(() => {
          if (!ac.signal.aborted) {
            setLoading(false);
          }
        });
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      abortRef.current?.abort();
    };
  }, [draftText, enabled, debounceMs, minLength]);

  return { suggestions, loading, fetchError };
}

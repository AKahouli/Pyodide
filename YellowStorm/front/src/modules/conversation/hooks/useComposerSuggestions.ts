import { useEffect, useRef, useState } from 'react';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import { fetchComposerSuggestions } from '../api';
import { parseComposerSuggestionsContent } from '../utils/parseComposerSuggestions';

const DEFAULT_DEBOUNCE_MS = 400;
const DEFAULT_MIN_LENGTH = 3;

/** apiClient rejects with `{ code, message, statusCode }` from the response interceptor. */
function httpStatusFromComposerError(err: unknown): number {
  if (typeof err === 'object' && err !== null && 'statusCode' in err && typeof (err as { statusCode: unknown }).statusCode === 'number') {
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

export function useComposerSuggestions({ draftText, enabled, debounceMs = DEFAULT_DEBOUNCE_MS, minLength = DEFAULT_MIN_LENGTH }: UseComposerSuggestionsOptions) {
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const { schedule, cancel } = useDebouncedCallback();
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    cancel();
    abortRef.current?.abort();

    if (!enabled) {
      setSuggestion(null);
      setLoading(false);
      setFetchError(false);
      return;
    }

    const text = draftText.trim();
    if (text.length < minLength) {
      setSuggestion(null);
      setLoading(false);
      setFetchError(false);
      return;
    }

    schedule(() => {
      const ac = new AbortController();
      abortRef.current = ac;
      setSuggestion(null);
      setLoading(true);
      setFetchError(false);

      fetchComposerSuggestions(text, ac.signal)
        .then(({ content }) => {
          if (ac.signal.aborted) return;
          const parsed = parseComposerSuggestionsContent(content);
          // Don't show suggestion if it's the same as the original text
          if (parsed && parsed.toLowerCase() !== text.toLowerCase()) {
            setSuggestion(parsed);
            setFetchError(false);
          } else {
            setSuggestion(null);
            setFetchError(false);
          }
        })
        .catch((err) => {
          if (ac.signal.aborted) return;
          const statusCode = httpStatusFromComposerError(err);
          // Nest returns 502 when ADK is down or misconfigured; avoid noisy "unavailable" UX.
          if (statusCode === 403 || statusCode === 429 || statusCode === 502) {
            setSuggestion(null);
            setFetchError(false);
            return;
          }
          setSuggestion(null);
          setFetchError(true);
        })
        .finally(() => {
          if (!ac.signal.aborted) {
            setLoading(false);
          }
        });
    }, debounceMs);

    return () => {
      cancel();
      abortRef.current?.abort();
    };
  }, [draftText, enabled, debounceMs, minLength, schedule, cancel]);

  return { suggestion, loading, fetchError };
}

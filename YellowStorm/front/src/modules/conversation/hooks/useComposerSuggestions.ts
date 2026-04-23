import { useEffect, useRef, useState } from 'react';
import { fetchComposerSuggestions } from '../api';
import { parseComposerSuggestionsContent } from '../utils/parseComposerSuggestions';
import { getAllAgents } from '@/modules/agent/api';

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
  agentId?: string;
}

export function useComposerSuggestions({
  draftText,
  enabled,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  minLength = DEFAULT_MIN_LENGTH,
  agentId,
}: UseComposerSuggestionsOptions) {
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [resolvedAgentId, setResolvedAgentId] = useState<string | undefined>(agentId);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch composer-suggestions agent once on mount if no agentId provided
  useEffect(() => {
    if (agentId) {
      setResolvedAgentId(agentId);
      return;
    }

    const fetchComposerAgent = async () => {
      try {
        const agents = await getAllAgents();

        // Priority 1: Find by name === 'Suggestions' (case-insensitive)
        let composerAgent = agents.find(
          (a) => a.name.toLowerCase() === 'suggestions' && a.isDefault
        );

        // Priority 2: Try to find by agentType.name === 'composer-suggestions'
        if (!composerAgent) {
          composerAgent = agents.find(
            (a) => a.agentType.name === 'composer-suggestions' && a.isDefault
          );
        }

        // Priority 3: Try to find by agentType.slug === 'composer-suggestions'
        if (!composerAgent) {
          composerAgent = agents.find(
            (a) => a.agentType.name === 'composer-suggestions' && a.isDefault
          );
        }

        if (composerAgent) {
          setResolvedAgentId(composerAgent.id);
        }
      } catch (err) {
        console.error('[ComposerSuggestions] Failed to fetch composer agent:', err);
      }
    };
    fetchComposerAgent();
  }, [agentId]);

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
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

    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      const ac = new AbortController();
      abortRef.current = ac;
      setSuggestion(null);
      setLoading(true);
      setFetchError(false);

      fetchComposerSuggestions(text, ac.signal, resolvedAgentId)
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
          if (statusCode === 502) {
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
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      abortRef.current?.abort();
    };
  }, [draftText, enabled, debounceMs, minLength, resolvedAgentId]);

  return { suggestion, loading, fetchError };
}

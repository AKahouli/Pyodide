import { useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { parseApiError } from '@/lib/api-error';
import { showError } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { semanticModelApi } from '../api';
import { semanticModelQueryKeys } from '../query/queryKeys';
import { useSemanticModelEditorStore } from '../store';
import type { AssistantChange } from '../types';
import { announceUndoable } from '../utils/undo-notice';

/** How often an open editor looks for changes made by assistants. */
export const ASSISTANT_SYNC_INTERVAL_MS = 4000;

/**
 * Keep an open editor in step with changes an assistant makes to the model. Each new change reloads the
 * model (edits not yet saved are replayed on top), is announced with an Undo button, and becomes a step
 * of the editor's Undo/Redo history. Also says when a data update is running, so it can be followed and stopped.
 */
export function useAssistantSync(modelId: string | undefined) {
  const { t } = useModuleTranslation('semantic-model');
  const queryClient = useQueryClient();
  // Server time of the last answer: only what happens after the editor opened is announced.
  const sinceRef = useRef<string | null>(null);
  const seenRef = useRef(new Set<string>());
  useEffect(() => { sinceRef.current = null; seenRef.current = new Set(); }, [modelId]);

  const query = useQuery({
    queryKey: ['semantic-models', 'assistant-changes', modelId],
    queryFn: async () => {
      const opening = sinceRef.current === null;
      const page = await semanticModelApi.assistantChanges(modelId!, sinceRef.current ?? undefined);
      sinceRef.current = page.now;
      // What was already there when the editor opened is history, not news.
      if (opening) page.changes.forEach((change) => seenRef.current.add(`${change.id}:${change.undoneAt ? 'undo' : 'redo'}`));
      return { ...page, opening };
    },
    enabled: Boolean(modelId),
    refetchInterval: ASSISTANT_SYNC_INTERVAL_MS,
    // Back from the chat (another tab or window): look at once, since polling pauses while hidden.
    refetchOnWindowFocus: 'always',
    staleTime: 0,
    retry: false,
  });

  const reload = useCallback(async () => {
    if (!modelId || useSemanticModelEditorStore.getState().saveInFlight) return false;
    const server = await semanticModelApi.graph(modelId);
    // A save that started meanwhile answers with its own revision; the next check reloads again if needed.
    if (useSemanticModelEditorStore.getState().saveInFlight) return false;
    useSemanticModelEditorStore.getState().rebase(server);
    for (const key of [
      semanticModelQueryKeys.sourceMappings(modelId), semanticModelQueryKeys.identityRules(modelId), semanticModelQueryKeys.mappingHealth(modelId),
      semanticModelQueryKeys.freshness(modelId), semanticModelQueryKeys.readiness(modelId), semanticModelQueryKeys.sourceSuggestions(modelId),
    ]) void queryClient.invalidateQueries({ queryKey: key });
    return true;
  }, [modelId, queryClient]);

  const announce = useCallback((change: AssistantChange) => {
    if (!modelId) return;
    const step = (action: 'undo' | 'redo') => async () => {
      try {
        await (action === 'undo' ? semanticModelApi.undoAssistantChange(modelId, change.id) : semanticModelApi.redoAssistantChange(modelId, change.id));
        seenRef.current.add(`${change.id}:${action}`);
        await reload();
      } catch (error) {
        showError(t(action === 'undo' ? 'designer.assistantChange.undoError' : 'designer.assistantChange.redoError'), { description: parseApiError(error).message });
        throw error;
      }
    };
    useSemanticModelEditorStore.getState().pushAction({ undo: step('undo'), redo: step('redo') });
    // Long enough to read what changed and decide.
    announceUndoable(`${t('designer.assistantChange.done')}: ${change.message}`, t('designer.assistantChange.undo'), 12000);
  }, [modelId, reload, t]);

  useEffect(() => {
    const page = query.data;
    if (!page || !modelId) return;
    if (page.opening) return;
    const fresh = page.changes.filter((change) => !seenRef.current.has(`${change.id}:${change.undoneAt ? 'undo' : 'redo'}`));
    fresh.forEach((change) => seenRef.current.add(`${change.id}:${change.undoneAt ? 'undo' : 'redo'}`));
    const local = useSemanticModelEditorStore.getState().graph;
    const behind = Boolean(local && page.graphRevision > local.revision);
    if (!behind && !fresh.length) return;
    void reload().catch(() => undefined);
    // Oldest first, so the latest change is the one Undo reaches first.
    [...fresh].reverse().filter((change) => !change.undoneAt).forEach(announce);
  }, [announce, modelId, query.data, reload]);

  // A data update running for the model, wherever it was started (here, or from a conversation).
  return { reload, activeRun: query.data?.activeRun ?? null };
}

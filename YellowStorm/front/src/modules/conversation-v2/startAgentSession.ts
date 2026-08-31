import type { NavigateFunction } from 'react-router-dom';
import { conversationV2Api } from './api';
import { writeSelectedModelForSession } from './selectedModelStorage';
import { useConversationV2PointersStore, useConversationV2Store } from './store';
import { useModelsStore } from '@/modules/models';

export type AgentSessionSource = 'new-conversation' | 'app-builder';

export interface StartAgentSessionParams {
  text: string;
  workspaceIds: string[];
  modelId: string | null;
  navigate: NavigateFunction;
  /** Where the session was started — used for transition UX on the session page. */
  source?: AgentSessionSource;
}

/**
 * Create a conversation-v2 session, surface it in the sidebar, and navigate to
 * the session page with the initial agent prompt (same path as Agent mode).
 */
export async function startConversationV2AgentSession({
  text,
  workspaceIds,
  modelId,
  navigate,
  source = 'new-conversation',
}: StartAgentSessionParams): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Agent prompt is required');
  }

  const { sessionId, workspaceIds: sessionWorkspaceIds } =
    await conversationV2Api.createSession(workspaceIds);

  useConversationV2PointersStore.getState().prepend({
    sessionId,
    title: '',
    status: 'active',
    lastEventAt: new Date().toISOString(),
    isShared: false,
    workspaceIds: sessionWorkspaceIds ?? workspaceIds,
  });

  let litellmModel: string | undefined;
  if (modelId) {
    writeSelectedModelForSession(sessionId, modelId);
  }
  const lookupId =
    modelId ??
    useModelsStore.getState().models.find((m) => m.isConversationV2Default)?.id ??
    null;
  if (lookupId) {
    const model = useModelsStore.getState().models.find((m) => m.id === lookupId);
    litellmModel = model?.litellmModel || undefined;
  }

  navigate(`/conversation-v2/${sessionId}`, {
    state: {
      initialMessage: trimmed,
      model: litellmModel,
      skillIds: useConversationV2Store.getState().selectedSkillIds,
      connectorIds: useConversationV2Store.getState().selectedConnectorIds,
      source,
    },
  });

  return sessionId;
}

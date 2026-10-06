import type { NavigateFunction } from 'react-router-dom';
import { conversationV2Api } from './api';
import { writeSelectedModelForSession } from './selectedModelStorage';
import { useConversationV2PointersStore, useConversationV2Store } from './store';
import { useModelsStore } from '@/modules/models';
import type { AgentSessionSource } from './interfaces';
import { studioCloneDraftPath, studioSessionPath } from './studio-paths';


export type { AgentSessionSource };

export interface StartAgentSessionParams {
  text: string;
  workspaceIds: string[];
  modelId: string | null;
  navigate: NavigateFunction;
  /** Where the session was started — used for transition UX on the session page. */
  source?: AgentSessionSource;
  /** Published app template to seed the session revision from (App Market → Use). */
  templateId?: string;
  /** Replace history when navigating (e.g. leaving a draft clone preview route). */
  navigationReplace?: boolean;
  /** OpenCode capability (`web_app` default). */
  capability?: 'web_app' | 'database_design';
}

export interface StartTemplateSessionParams {
  templateId: string;
  workspaceIds?: string[];
  modelId?: string | null;
  navigate: NavigateFunction;
}

function prependSessionPointer(sessionId: string, workspaceIds: string[]): void {
  useConversationV2PointersStore.getState().prepend({
    sessionId,
    title: '',
    status: 'active',
    lastEventAt: new Date().toISOString(),
    isShared: false,
    workspaceIds,
  });
}

function resolveLitellmModel(modelId: string | null): string | undefined {
  const lookupId =
    modelId ??
    useModelsStore.getState().models.find((m) => m.isConversationV2Default)?.id ??
    null;
  if (!lookupId) return undefined;
  const model = useModelsStore.getState().models.find((m) => m.id === lookupId);
  return model?.litellmModel || undefined;
}

/**
 * Create a Studio session, surface it in the sidebar, and navigate to the
 * session page with the initial agent prompt (same path as Agent mode).
 */
export async function startConversationV2AgentSession({
  text,
  workspaceIds,
  modelId,
  navigate,
  source = 'new-conversation',
  templateId,
  navigationReplace = false,
  capability = 'web_app',
}: StartAgentSessionParams): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Agent prompt is required');
  }

  const { sessionId, workspaceIds: sessionWorkspaceIds } =
    await conversationV2Api.createSession(workspaceIds, templateId, capability);

  prependSessionPointer(sessionId, sessionWorkspaceIds ?? workspaceIds);

  if (modelId) {
    writeSelectedModelForSession(sessionId, modelId);
  }
  const litellmModel = resolveLitellmModel(modelId);

  navigate(studioSessionPath(sessionId), {
    replace: navigationReplace,
    state: {
      initialMessage: trimmed,
      model: litellmModel,
      skillIds: useConversationV2Store.getState().selectedSkillIds,
      connectorIds: useConversationV2Store.getState().selectedConnectorIds,
      source,
      ...(templateId ? { templateId } : {}),
      ...(capability ? { capability } : {}),
    },
  });

  return sessionId;
}

/**
 * App Market "Clone App": create the Studio session immediately and open
 * `/studio/{sessionId}?action=clone`. History is deferred until the first Send
 * (when `action=clone` is stripped).
 */
export async function startTemplateSession({
  templateId,
  workspaceIds = [],
  modelId = null,
  navigate,
}: StartTemplateSessionParams): Promise<string> {
  const trimmedId = templateId.trim();
  if (!trimmedId) {
    throw new Error('Template id is required');
  }

  const { sessionId } = await conversationV2Api.createSession(workspaceIds, trimmedId);

  if (modelId) {
    writeSelectedModelForSession(sessionId, modelId);
  }

  navigate(studioCloneDraftPath(sessionId), {
    state: {
      source: 'template-clone' as const,
      templateId: trimmedId,
    },
  });

  return sessionId;
}

/**
 * First Send on a clone draft: add the session to History and drop `?action=clone`
 * so the same session URL is no longer a draft. Does not change the session id.
 */
export function commitCloneDraftSession(
  sessionId: string,
  navigate: NavigateFunction,
  workspaceIds?: string[],
): void {
  const id = sessionId.trim();
  if (!id) return;

  const ids =
    workspaceIds ?? useConversationV2Store.getState().workspaceIds ?? [];
  prependSessionPointer(id, ids);

  navigate(studioSessionPath(id), { replace: true });
}

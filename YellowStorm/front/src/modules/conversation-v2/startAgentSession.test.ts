import { describe, it, expect, vi, beforeEach } from 'vitest';

const createSessionMock = vi.hoisted(() => vi.fn());
const prependMock = vi.hoisted(() => vi.fn());
const writeSelectedModelMock = vi.hoisted(() => vi.fn());
const getStateMock = vi.hoisted(() =>
  vi.fn(() => ({
    selectedSkillIds: ['skill-1'],
    selectedConnectorIds: ['conn-1'],
    workspaceIds: ['ws-from-store'],
  })),
);

vi.mock('./api', () => ({
  conversationV2Api: {
    createSession: createSessionMock,
  },
}));

vi.mock('./store', () => ({
  useConversationV2PointersStore: {
    getState: () => ({ prepend: prependMock }),
  },
  useConversationV2Store: {
    getState: getStateMock,
  },
}));

vi.mock('./selectedModelStorage', () => ({
  writeSelectedModelForSession: writeSelectedModelMock,
}));

vi.mock('@/modules/models', () => ({
  useModelsStore: {
    getState: () => ({
      models: [{ id: 'model-1', litellmModel: 'azure/gpt-4.1', isConversationV2Default: true }],
    }),
  },
}));

import {
  startConversationV2AgentSession,
  startTemplateSession,
  commitCloneDraftSession,
} from './startAgentSession';

describe('startConversationV2AgentSession', () => {
  const navigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    createSessionMock.mockResolvedValue({
      sessionId: 'session-new',
      workspaceIds: ['ws-1'],
    });
  });

  it('creates a session and navigates with agent payload including source', async () => {
    await startConversationV2AgentSession({
      text: 'Build a CRM',
      workspaceIds: ['ws-1'],
      modelId: 'model-1',
      navigate,
      source: 'app-builder',
    });

    expect(createSessionMock).toHaveBeenCalledWith(['ws-1'], undefined);
    expect(prependMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-new', workspaceIds: ['ws-1'] }),
    );
    expect(writeSelectedModelMock).toHaveBeenCalledWith('session-new', 'model-1');
    expect(navigate).toHaveBeenCalledWith('/conversation-v2/session-new', {
      replace: false,
      state: {
        initialMessage: 'Build a CRM',
        model: 'azure/gpt-4.1',
        skillIds: ['skill-1'],
        connectorIds: ['conn-1'],
        source: 'app-builder',
      },
    });
  });

  it('passes the selected templateId to createSession', async () => {
    await startConversationV2AgentSession({
      text: 'Customize',
      workspaceIds: [],
      modelId: null,
      navigate,
      source: 'app-builder',
      templateId: 'tpl-1',
    });

    expect(createSessionMock).toHaveBeenCalledWith([], 'tpl-1');
    expect(navigate).toHaveBeenCalledWith('/conversation-v2/session-new', {
      replace: false,
      state: expect.objectContaining({
        initialMessage: 'Customize',
        templateId: 'tpl-1',
        source: 'app-builder',
      }),
    });
  });
});

describe('startTemplateSession', () => {
  const navigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    createSessionMock.mockResolvedValue({
      sessionId: '33209d21af8ec4c6c8af7f37',
      workspaceIds: [],
    });
  });

  it('creates a session and opens ?action=clone without History or template id in the URL', async () => {
    const sessionId = await startTemplateSession({
      templateId: 'tpl-42',
      navigate,
    });

    expect(sessionId).toBe('33209d21af8ec4c6c8af7f37');
    expect(createSessionMock).toHaveBeenCalledWith([], 'tpl-42');
    expect(prependMock).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(
      '/conversation-v2/33209d21af8ec4c6c8af7f37?action=clone',
      {
        state: {
          source: 'template-clone',
          templateId: 'tpl-42',
        },
      },
    );
  });

  it('rejects an empty template id', async () => {
    await expect(startTemplateSession({ templateId: '  ', navigate })).rejects.toThrow(
      /Template id is required/,
    );
    expect(createSessionMock).not.toHaveBeenCalled();
  });
});

describe('commitCloneDraftSession', () => {
  const navigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prepends History and replaces to the same session without ?action=clone', () => {
    commitCloneDraftSession('33209d21af8ec4c6c8af7f37', navigate, ['ws-1']);

    expect(prependMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: '33209d21af8ec4c6c8af7f37',
        workspaceIds: ['ws-1'],
      }),
    );
    expect(navigate).toHaveBeenCalledWith('/conversation-v2/33209d21af8ec4c6c8af7f37', {
      replace: true,
    });
  });

  it('falls back to store workspaceIds when none are passed', () => {
    commitCloneDraftSession('sess-1', navigate);

    expect(prependMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess-1', workspaceIds: ['ws-from-store'] }),
    );
  });
});

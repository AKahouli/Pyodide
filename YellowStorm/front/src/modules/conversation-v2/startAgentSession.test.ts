import { describe, it, expect, vi, beforeEach } from 'vitest';

const createSessionMock = vi.hoisted(() => vi.fn());
const prependMock = vi.hoisted(() => vi.fn());
const writeSelectedModelMock = vi.hoisted(() => vi.fn());
const getStateMock = vi.hoisted(() =>
  vi.fn(() => ({
    selectedSkillIds: ['skill-1'],
    selectedConnectorIds: ['conn-1'],
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

import { startConversationV2AgentSession } from './startAgentSession';

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

    expect(createSessionMock).toHaveBeenCalledWith(['ws-1']);
    expect(prependMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-new', workspaceIds: ['ws-1'] }),
    );
    expect(writeSelectedModelMock).toHaveBeenCalledWith('session-new', 'model-1');
    expect(navigate).toHaveBeenCalledWith('/conversation-v2/session-new', {
      state: {
        initialMessage: 'Build a CRM',
        model: 'azure/gpt-4.1',
        skillIds: ['skill-1'],
        connectorIds: ['conn-1'],
        source: 'app-builder',
      },
    });
  });
});

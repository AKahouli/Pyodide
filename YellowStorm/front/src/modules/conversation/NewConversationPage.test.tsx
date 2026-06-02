import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NewConversationPage } from './NewConversationPage';

const createConversationMock = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'conv-1' }));
const updateConversationMock = vi.hoisted(() => vi.fn());
const sendMessageMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const resetSelectedWorkspaceIdsMock = vi.hoisted(() => vi.fn());
const clearAllMock = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock('@/components/ai-elements/input', () => ({
  default: ({
    onSubmit,
  }: {
    onSubmit: (
      message: { text: string },
      modelId: string,
      agentIds?: string[],
      memberIds?: string[],
      workspaceIds?: string[],
      connectorRepo?: {
        connectorId: string;
        connectorName: string;
        repoId: string;
        repoName: string;
        repoUrl?: string;
      },
    ) => Promise<void>;
  }) => (
    <button
      type='button'
      onClick={() => {
        void onSubmit(
          { text: 'hello' },
          'model-1',
          ['agent-1'],
          undefined,
          ['ws-1'],
          {
            connectorId: 'connector-1',
            connectorName: 'GitHub',
            repoId: 'repo-1',
            repoName: 'org-name/repo-name',
            repoUrl: 'https://github.com/org-name/repo-name',
          },
        );
      }}
    >
      submit-new-conversation
    </button>
  ),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('./store', () => ({
  useConversationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      createConversation: createConversationMock,
      updateConversation: updateConversationMock,
      sendMessage: sendMessageMock,
    }),
  useInputDisabled: () => false,
  useSelectedWorkspaceIds: () => [],
  useResetSelectedWorkspaceIds: () => resetSelectedWorkspaceIdsMock,
}));

vi.mock('./hooks/useConversationFileUpload', () => ({
  useConversationFileUpload: () => ({
    files: [],
    addFiles: vi.fn(),
    removeFile: vi.fn(),
    completedFileIds: [],
    isUploading: false,
    conversationId: null,
    clearAll: clearAllMock,
  }),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/modules/usage', () => ({
  useUsage: () => ({ status: { isLimitExceeded: false } }),
}));

vi.mock('./components/GroupChatButton', () => ({
  GroupChatButton: () => <div>group-chat-button</div>,
}));

vi.mock('./components/SelectedConnectorRepo', () => ({
  SelectedConnectorRepo: () => <div>selected-connector-repo</div>,
}));

vi.mock('./components/ComposerSuggestionChips', () => ({
  ComposerSuggestionChips: () => <div>chips</div>,
}));

vi.mock('@/modules/playbook/components/playbook-swiper', () => ({
  PlaybooksCarousel: () => <div>playbooks</div>,
}));

vi.mock('@/modules/models', () => ({
  useChefs: () => [],
  useDefaultModel: () => null,
  useModels: () => [],
  useModelsStore: {
    getState: () => ({
      models: [],
      fetchModels: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock('@/modules/workspace/components/WorkspaceSelect', () => ({
  WorkspaceSelect: () => <div>workspace-select</div>,
}));

vi.mock('@/modules/conversation-v2/api', () => ({
  conversationV2Api: {
    createSession: vi.fn(),
  },
}));

vi.mock('@/modules/conversation/effects/stars-background', () => ({
  StarsBackground: () => <div>stars</div>,
}));

describe('NewConversationPage', () => {
  it('forwards selected connector repo on first legacy message', async () => {
    render(<NewConversationPage />);

    await userEvent.click(screen.getByRole('button', { name: 'submit-new-conversation' }));

    await waitFor(() => {
      expect(createConversationMock).toHaveBeenCalledWith({ workspaces: ['ws-1'] });
      expect(sendMessageMock).toHaveBeenCalledWith('conv-1', {
        content: 'hello',
        modelId: 'model-1',
        agentIds: ['agent-1'],
        connectorRepo: {
          connectorId: 'connector-1',
          connectorName: 'GitHub',
          repoId: 'repo-1',
          repoName: 'org-name/repo-name',
          repoUrl: 'https://github.com/org-name/repo-name',
        },
      });
      expect(clearAllMock).toHaveBeenCalled();
      expect(resetSelectedWorkspaceIdsMock).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/conversation/conv-1');
    });
  });
});

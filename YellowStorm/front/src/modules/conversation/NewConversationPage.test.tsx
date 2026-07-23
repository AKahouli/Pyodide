import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewConversationPage } from './NewConversationPage';

const createConversationMock = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'conv-1' }));
const updateConversationMock = vi.hoisted(() => vi.fn());
const claimCurrentConversationMock = vi.hoisted(() => vi.fn());
const sendMessageMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const setConversationStateMock = vi.hoisted(() => vi.fn());
const clearAllMock = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());
const selectedWorkspaceIdsMock = vi.hoisted(() => ({ value: ['ws-1'] as string[] }));
const uploadConversationIdMock = vi.hoisted(() => ({ value: null as string | null }));

vi.mock('@/components/ai-elements/input', () => ({
  default: ({
    onSubmit,
    preserveWorkspaceSelectionOnSubmit,
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
    preserveWorkspaceSelectionOnSubmit?: boolean;
  }) => (
    <>
      <span>{preserveWorkspaceSelectionOnSubmit ? 'workspace-selection-preserved' : 'workspace-selection-reset'}</span>
      <button
        type='button'
        onClick={() => {
          void onSubmit(
            { text: 'hello' },
            'model-1',
            ['agent-1'],
            undefined,
            selectedWorkspaceIdsMock.value,
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
    </>
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
  useConversationStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        createConversation: createConversationMock,
        updateConversation: updateConversationMock,
        claimCurrentConversation: claimCurrentConversationMock,
        sendMessage: sendMessageMock,
      }),
    {
      setState: setConversationStateMock,
      getState: () => ({ conversations: [], selectedSkillIds: [], selectedConnectorRepo: null }),
    },
  ),
  useInputDisabled: () => false,
  useSelectedWorkspaceIds: () => selectedWorkspaceIdsMock.value,
}));

vi.mock('./hooks/useConversationFileUpload', () => ({
  useConversationFileUpload: () => ({
    files: [],
    addFiles: vi.fn(),
    removeFile: vi.fn(),
    completedFileIds: [],
    isUploading: false,
    conversationId: uploadConversationIdMock.value,
    clearAll: clearAllMock,
  }),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/modules/usage/UsageContext', () => ({
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

vi.mock('@/modules/governance/components/consumer/GovernedScopesCarousel', () => ({
  GovernedScopesCarousel: () => <div>governed-scopes</div>,
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
  beforeEach(() => {
    vi.clearAllMocks();
    createConversationMock.mockResolvedValue({ id: 'conv-1' });
    sendMessageMock.mockResolvedValue(undefined);
    selectedWorkspaceIdsMock.value = ['ws-1'];
    uploadConversationIdMock.value = null;
  });

  it('forwards selected connector repo on first legacy message', async () => {
    render(<NewConversationPage />);

    expect(screen.getByText('workspace-selection-preserved')).toBeInTheDocument();
    expect(setConversationStateMock).toHaveBeenCalledWith({
      currentConversationId: null,
      selectedSkillIds: [],
      selectedWorkspaceIds: [],
    });

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
      expect(mockNavigate).toHaveBeenCalledWith('/conversation/conv-1');
      expect(claimCurrentConversationMock).toHaveBeenCalledWith('conv-1', { id: 'conv-1' });
      expect(claimCurrentConversationMock.mock.invocationCallOrder[0]).toBeLessThan(mockNavigate.mock.invocationCallOrder[0]);
      expect(mockNavigate.mock.invocationCallOrder[0]).toBeLessThan(sendMessageMock.mock.invocationCallOrder[0]);
    });
  });

  it('clears workspaces on a conversation created before file upload completes', async () => {
    uploadConversationIdMock.value = 'conv-upload';
    selectedWorkspaceIdsMock.value = [];
    render(<NewConversationPage />);

    await userEvent.click(screen.getByRole('button', { name: 'submit-new-conversation' }));

    await waitFor(() => {
      expect(createConversationMock).not.toHaveBeenCalled();
      expect(updateConversationMock).toHaveBeenCalledWith('conv-upload', { workspaces: [] });
      expect(claimCurrentConversationMock).toHaveBeenCalledWith('conv-upload', undefined);
      expect(sendMessageMock).toHaveBeenCalledWith('conv-upload', expect.objectContaining({ content: 'hello' }));
    });
  });
});

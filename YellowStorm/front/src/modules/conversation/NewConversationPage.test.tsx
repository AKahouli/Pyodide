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
const selectedReasoningEffortMock = vi.hoisted(() => ({ value: null as string | null }));
const setSelectedReasoningEffortMock = vi.hoisted(() => vi.fn((value: string) => {
  selectedReasoningEffortMock.value = value;
}));
const submitRoutingMock = vi.hoisted(() => ({
  agentIds: ['agent-1'] as string[] | undefined,
  memberIds: undefined as string[] | undefined,
  teamIds: undefined as string[] | undefined,
}));
const usageStatusMock = vi.hoisted(() => ({
  value: { isLimitExceeded: false, plan: { name: 'Free' }, resetsAt: new Date(Date.now() + 3600000).toISOString() },
}));

vi.mock('@/components/ai-elements/input', () => ({
  default: ({
    onSubmit,
    preserveWorkspaceSelectionOnSubmit,
    extraTools,
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
      teamIds?: string[],
    ) => Promise<void>;
    preserveWorkspaceSelectionOnSubmit?: boolean;
    extraTools?: React.ReactNode;
  }) => (
    <>
      <span>{preserveWorkspaceSelectionOnSubmit ? 'workspace-selection-preserved' : 'workspace-selection-reset'}</span>
      {extraTools}
      <button
        type='button'
        onClick={() => {
          void onSubmit(
            { text: 'hello' },
            'model-1',
            submitRoutingMock.agentIds,
            submitRoutingMock.memberIds,
            selectedWorkspaceIdsMock.value,
            {
              connectorId: 'connector-1',
              connectorName: 'GitHub',
              repoId: 'repo-1',
              repoName: 'org-name/repo-name',
              repoUrl: 'https://github.com/org-name/repo-name',
            },
            submitRoutingMock.teamIds,
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
  useSelectedModelId: () => 'model-1',
  useSelectedReasoningEffort: () => selectedReasoningEffortMock.value,
  useSelectedSemanticModelId: () => null,
  useSelectedWorkspaceIds: () => selectedWorkspaceIdsMock.value,
  useSetSelectedReasoningEffort: () => setSelectedReasoningEffortMock,
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
  useUsage: () => ({ status: usageStatusMock.value }),
}));

vi.mock('@/modules/usage/components/UsageLimitBanner', () => ({
  UsageLimitBanner: () => <div role='alert'>usage-limit-banner</div>,
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
  useDefaultModel: () => ({
    id: 'model-1',
    supportsReasoning: true,
    reasoning: {
      defaultEffort: 'medium',
      efforts: [
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
      ],
    },
  }),
  useModels: () => [{
    id: 'model-1',
    supportsReasoning: true,
    reasoning: {
      defaultEffort: 'medium',
      efforts: [
        { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' },
      ],
    },
  }],
  useModelsStore: {
    getState: () => ({
      models: [{ id: 'model-1', litellmModel: 'provider/model-1' }],
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
    usageStatusMock.value = {
      isLimitExceeded: false,
      plan: { name: 'Free' },
      resetsAt: new Date(Date.now() + 3600000).toISOString(),
    };
    createConversationMock.mockResolvedValue({ id: 'conv-1' });
    sendMessageMock.mockResolvedValue(undefined);
    selectedWorkspaceIdsMock.value = ['ws-1'];
    uploadConversationIdMock.value = null;
    selectedReasoningEffortMock.value = null;
    submitRoutingMock.agentIds = ['agent-1'];
    submitRoutingMock.memberIds = undefined;
    submitRoutingMock.teamIds = undefined;
  });

  it('shows a quota alert on the chat page when the plan limit is exceeded', () => {
    usageStatusMock.value = {
      isLimitExceeded: true,
      plan: { name: 'Free' },
      resetsAt: new Date(Date.now() + 3600000).toISOString(),
    };

    render(<NewConversationPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('usage-limit-banner');
  });

  it('forwards selected connector repo on first legacy message', async () => {
    render(<NewConversationPage />);

    expect(screen.getByText('workspace-selection-preserved')).toBeInTheDocument();
    expect(setConversationStateMock).toHaveBeenCalledWith({
      currentConversationId: null,
      selectedSemanticModelId: null,
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
      expect(claimCurrentConversationMock).toHaveBeenCalledWith('conv-1', { id: 'conv-1' }, {
        modelId: 'model-1',
        workspaceIds: ['ws-1'],
      });
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
      expect(claimCurrentConversationMock).toHaveBeenCalledWith('conv-upload', undefined, {
        modelId: 'model-1',
        workspaceIds: [],
      });
      expect(sendMessageMock).toHaveBeenCalledWith('conv-upload', expect.objectContaining({ content: 'hello' }));
    });
  });

  it('uses the model default reasoning effort for an untagged first legacy message', async () => {
    submitRoutingMock.agentIds = undefined;
    render(<NewConversationPage />);

    expect(screen.getByRole('button', { name: 'input.reasoning.label' })).toBeInTheDocument();
    const reasoning = screen.getByRole('button', { name: 'input.reasoning.label' });
    const reliability = screen.getByRole('button', { name: 'input.autoReliability' });
    expect(reliability).toHaveAttribute('aria-pressed', 'false');
    expect(reasoning.compareDocumentPosition(reliability) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'submit-new-conversation' }));

    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ modelId: 'model-1', reasoningEffort: 'medium' }),
    ));
  });

  it('uses an explicitly selected reasoning effort for the first legacy message', async () => {
    submitRoutingMock.agentIds = undefined;
    const { rerender } = render(<NewConversationPage />);

    await userEvent.click(screen.getByRole('button', { name: 'input.reasoning.label' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'High' }));
    expect(setSelectedReasoningEffortMock).toHaveBeenCalledWith('high');

    rerender(<NewConversationPage />);
    await userEvent.click(screen.getByRole('button', { name: 'submit-new-conversation' }));

    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ reasoningEffort: 'high' }),
    ));
  });

  it.each([
    ['agent', ['agent-1'], undefined, undefined],
    ['member', undefined, ['member-1'], undefined],
    ['team', undefined, undefined, ['team-1']],
  ])('omits reasoning effort for a %s-tagged first message', async (_kind, agentIds, memberIds, teamIds) => {
    submitRoutingMock.agentIds = agentIds;
    submitRoutingMock.memberIds = memberIds;
    submitRoutingMock.teamIds = teamIds;
    render(<NewConversationPage />);

    await userEvent.click(screen.getByRole('button', { name: 'submit-new-conversation' }));

    await waitFor(() => expect(sendMessageMock).toHaveBeenCalled());
    expect(sendMessageMock.mock.calls.at(-1)?.[1]).not.toHaveProperty('reasoningEffort');
  });
});

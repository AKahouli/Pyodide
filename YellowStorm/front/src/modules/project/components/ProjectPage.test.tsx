import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectPage } from './ProjectPage';

const createConversationMock = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'conv-1' }));
const sendMessageMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const incrementCountMock = vi.hoisted(() => vi.fn());
const resetSelectedWorkspaceIdsMock = vi.hoisted(() => vi.fn());
const clearAllMock = vi.hoisted(() => vi.fn());
const fetchProjectConversationsMock = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());
const selectedReasoningEffortMock = vi.hoisted(() => ({ value: null as string | null }));
const setSelectedReasoningEffortMock = vi.hoisted(() => vi.fn((value: string) => {
  selectedReasoningEffortMock.value = value;
}));
const submitRoutingMock = vi.hoisted(() => ({
  agentIds: undefined as string[] | undefined,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: 'project-1' }),
    NavLink: () => <a href='/'>back-link</a>,
  };
});

vi.mock('@/modules/auth', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'owner@example.com', profile: {} } }),
}));

vi.mock('@/components/ai-elements/input', () => ({
  default: ({
    onSubmit,
    placeholder,
    showModelSelector,
    extraTools,
  }: {
    onSubmit: (
      message: { text: string },
      modelId: string,
      agentIds?: string[],
      memberIds?: string[],
      workspaceIds?: string[],
      connectorRepo?: unknown,
      teamIds?: string[],
    ) => Promise<void>;
    placeholder?: string;
    showModelSelector?: boolean;
    extraTools?: React.ReactNode;
  }) => (
    <>
      <span>{placeholder}</span>
      <span>{showModelSelector ? 'model-selector-visible' : 'model-selector-hidden'}</span>
      {extraTools}
      <button
        type='button'
        onClick={() => {
          void onSubmit({ text: 'hello' }, 'model-1', submitRoutingMock.agentIds);
        }}
      >
        submit-project-conversation
      </button>
    </>
  ),
}));

vi.mock('@/modules/project', () => ({
  useProjects: () => [{ id: 'project-1', name: 'Apollo', createdBy: 'user-1' }],
  useSharedProjects: () => [],
  useProjectStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      initialized: true,
      fetchProjects: vi.fn(),
      renameProject: vi.fn(),
      deleteProject: vi.fn(),
      incrementCount: incrementCountMock,
    }),
  RenameProjectDialog: () => null,
  ShareProjectDialog: () => null,
  DeleteProjectDialog: () => null,
}));

vi.mock('@/modules/conversation/store', () => ({
  useConversationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      createConversation: createConversationMock,
      sendMessage: sendMessageMock,
      fetchProjectConversations: fetchProjectConversationsMock,
    }),
  useConversationsByProject: () => [],
  useInputDisabled: () => false,
  useResetSelectedWorkspaceIds: () => resetSelectedWorkspaceIdsMock,
  useSelectedModelId: () => 'model-1',
  useSelectedReasoningEffort: () => selectedReasoningEffortMock.value,
  useSetSelectedReasoningEffort: () => setSelectedReasoningEffortMock,
}));

vi.mock('@/modules/conversation/translation', () => ({
  translateConversation: (key: string) => key,
}));

vi.mock('@/modules/conversation/components/RenameDialog', () => ({
  RenameDialog: () => null,
}));

vi.mock('@/modules/conversation/components/DeleteConversationDialog', () => ({
  DeleteConversationDialog: () => null,
}));

vi.mock('@/modules/conversation/hooks/useConversationFileUpload', () => ({
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

vi.mock('@/modules/workspace/hooks/useAllowedUploadExtensions', () => ({
  useAllowedUploadExtensions: () => ({ accept: '' }),
}));

vi.mock('@/modules/usage/UsageContext', () => ({
  useUsage: () => ({ status: { isLimitExceeded: false } }),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/modules/models', () => ({
  useModels: () => [
    {
      id: 'model-1',
      supportsReasoning: true,
      reasoning: {
        defaultEffort: 'medium',
        efforts: [
          { id: 'medium', name: 'Medium' },
          { id: 'high', name: 'High' },
        ],
      },
    },
  ],
  useDefaultModel: () => null,
}));

describe('ProjectPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createConversationMock.mockResolvedValue({ id: 'conv-1' });
    sendMessageMock.mockResolvedValue(undefined);
    selectedReasoningEffortMock.value = null;
    submitRoutingMock.agentIds = undefined;
  });

  it('shows the model selector and reasoning effort dropdown and ships the model default effort', async () => {
    render(<ProjectPage />);

    expect(screen.getByText('projects.page.composerPlaceholder')).toBeInTheDocument();
    expect(screen.getByText('model-selector-visible')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'input.reasoning.label' })).toHaveTextContent('Medium');

    await userEvent.click(screen.getByRole('button', { name: 'submit-project-conversation' }));

    await waitFor(() => {
      expect(createConversationMock).toHaveBeenCalledWith({ projectId: 'project-1' });
      expect(incrementCountMock).toHaveBeenCalledWith('project-1');
      expect(mockNavigate).toHaveBeenCalledWith('/conversation/conv-1');
      expect(sendMessageMock).toHaveBeenCalledWith('conv-1', expect.objectContaining({
        content: 'hello',
        modelId: 'model-1',
        reasoningEffort: 'medium',
      }));
    });
  });

  it('omits reasoning effort for an agent-tagged first message', async () => {
    submitRoutingMock.agentIds = ['agent-1'];
    render(<ProjectPage />);

    await userEvent.click(screen.getByRole('button', { name: 'submit-project-conversation' }));

    await waitFor(() => expect(sendMessageMock).toHaveBeenCalled());
    expect(sendMessageMock.mock.calls.at(-1)?.[1]).not.toHaveProperty('reasoningEffort');
  });

  it('uses an explicitly picked reasoning effort for the first message', async () => {
    const { rerender } = render(<ProjectPage />);

    await userEvent.click(screen.getByRole('button', { name: 'input.reasoning.label' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'High' }));
    expect(setSelectedReasoningEffortMock).toHaveBeenCalledWith('high');

    rerender(<ProjectPage />);
    await userEvent.click(screen.getByRole('button', { name: 'submit-project-conversation' }));

    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ reasoningEffort: 'high' }),
    ));
  });
});

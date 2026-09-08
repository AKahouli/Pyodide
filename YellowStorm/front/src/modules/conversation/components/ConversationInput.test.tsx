import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationInput } from './ConversationInput';

const sendMessageMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const updateConversationMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const stopStreamMock = vi.hoisted(() => vi.fn());
const clearAllMock = vi.hoisted(() => vi.fn());
const currentConversationMock = vi.hoisted(() => ({
  value: { id: 'conv-1', workspaces: ['ws-1'] } as { id: string; workspaces: string[]; runtimeMode?: 'standard' | 'governed'; runtimePurpose?: 'platform_copilot'; taggedAgentIds?: string[] },
}));
const workspaceSelectionMock = vi.hoisted(() => ({
  value: ['ws-2'] as string[],
  set: vi.fn((workspaceIds: string[]) => {
    workspaceSelectionMock.value = workspaceIds;
  }),
}));

vi.mock('@/components/ai-elements/input', () => ({
  default: ({
    onSubmit,
    showWorkspaceSelect,
    preserveWorkspaceSelectionOnSubmit,
    onWorkspaceSelectionChange,
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
    ) => Promise<void>;
    showWorkspaceSelect?: boolean;
    preserveWorkspaceSelectionOnSubmit?: boolean;
    onWorkspaceSelectionChange?: (workspaceIds: string[]) => void;
    extraTools?: React.ReactNode;
  }) => (
    <>
      <span>{showWorkspaceSelect ? 'workspace-selector-visible' : 'workspace-selector-hidden'}</span>
      <span>{preserveWorkspaceSelectionOnSubmit ? 'workspace-selection-preserved' : 'workspace-selection-reset'}</span>
      <button type='button' onClick={() => {
        workspaceSelectionMock.set(['ws-2']);
        onWorkspaceSelectionChange?.(['ws-2']);
      }}>select-workspace</button>
      <button type='button' onClick={() => {
        workspaceSelectionMock.set(['ws-3']);
        onWorkspaceSelectionChange?.(['ws-3']);
      }}>select-another-workspace</button>
      {extraTools}
      <button
        type='button'
        onClick={() => {
          void onSubmit(
            { text: 'hello' },
            'model-1',
            ['agent-1'],
            undefined,
            ['ws-2'],
            {
              connectorId: 'connector-1',
              connectorName: 'GitHub',
              repoId: 'repo-1',
              repoName: 'org-name/repo-name',
              repoUrl: 'https://github.com/org-name/repo-name',
            },
          );
        }}>
        submit-message
      </button>
      <button
        type='button'
        onClick={() => void onSubmit({ text: 'hello' }, 'model-1')}
      >
        submit-with-reasoning
      </button>
      <button
        type='button'
        onClick={() => void onSubmit({ text: 'hello' }, 'model-1', undefined, ['member-1'])}
      >
        submit-to-member
      </button>
    </>
  ),
}));

vi.mock('@/modules/usage', () => ({
  UsageLimitBanner: () => <div>usage-banner</div>,
}));

vi.mock('@/modules/usage/UsageContext', () => ({
  useUsage: () => ({ status: { isLimitExceeded: false } }),
}));

vi.mock('@/modules/workspace/hooks/useAllowedUploadExtensions', () => ({
  useAllowedUploadExtensions: () => ({ accept: '*' }),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('./ComposerSuggestionChips', () => ({
  ComposerSuggestionChips: () => null,
}));

vi.mock('./SelectedConnectorRepo', () => ({
  SelectedConnectorRepo: () => null,
}));

vi.mock('../hooks/useConversationFileUpload', () => ({
  useConversationFileUpload: () => ({
    files: [{ localId: 'l1', file: new File(['x'], 'a.txt', { type: 'text/plain' }), status: 'completed', progress: 100, documentId: 'doc-1' }],
    addFiles: vi.fn(),
    removeFile: vi.fn(),
    completedFileIds: ['doc-1'],
    isUploading: false,
    clearAll: clearAllMock,
  }),
}));

vi.mock('@/modules/auth/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/modules/models', () => ({
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
  useDefaultModel: () => undefined,
}));

vi.mock('../store', () => ({
  useConversationStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        sendMessage: sendMessageMock,
        updateConversation: updateConversationMock,
        stopStream: stopStreamMock,
        clearReplyingTo: vi.fn(),
        isStreaming: false,
        selectedSkillIds: [],
        selectedConnectorRepo: {
          connectorId: 'connector-1',
          connectorName: 'GitHub',
          repoId: 'repo-1',
          repoName: 'org-name/repo-name',
          repoUrl: 'https://github.com/org-name/repo-name',
        },
        messages: [],
        currentConversation: currentConversationMock.value,
      }),
    {
      getState: () => ({
        selectedWorkspaceIds: workspaceSelectionMock.value,
        selectedSkillIds: [],
        selectedConnectorRepo: {
          connectorId: 'connector-1',
          connectorName: 'GitHub',
          repoId: 'repo-1',
          repoName: 'org-name/repo-name',
          repoUrl: 'https://github.com/org-name/repo-name',
        },
      }),
    },
  ),
  useIsAwaitingFirstChunk: () => false,
  useInputDisabled: () => false,
  useReplyingToMessage: () => null,
  useSelectedWorkspaceIds: () => workspaceSelectionMock.value,
  useSetSelectedWorkspaceIds: () => workspaceSelectionMock.set,
  useDeepSearchEnabled: () => false,
  useSetDeepSearchEnabled: () => vi.fn(),
  useSelectedModelId: () => 'model-1',
  useSelectedReasoningEffort: () => 'high',
  useSetSelectedReasoningEffort: () => vi.fn(),
  useSelectedConnectorRepo: () => ({
    connectorId: 'connector-1',
    connectorName: 'GitHub',
    repoId: 'repo-1',
    repoName: 'org-name/repo-name',
    repoUrl: 'https://github.com/org-name/repo-name',
  }),
  useSetSelectedConnectorRepo: () => vi.fn(),
}));

describe('ConversationInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentConversationMock.value = { id: 'conv-1', workspaces: ['ws-1'] };
    workspaceSelectionMock.value = ['ws-2'];
  });

  it('submits message with uploaded files and clears upload state', async () => {
    render(<ConversationInput conversationId='conv-1' />);

    expect(screen.getByText('workspace-selector-visible')).toBeInTheDocument();
    expect(screen.getByText('workspace-selection-preserved')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'submit-message' }));

    await waitFor(() => {
      expect(updateConversationMock).toHaveBeenCalledWith('conv-1', { workspaces: ['ws-2'] });
      expect(sendMessageMock).toHaveBeenCalledWith('conv-1', {
        content: 'hello',
        attachedFileIds: ['doc-1'],
        attachedFiles: [
          {
            id: 'doc-1',
            originalName: 'a.txt',
            mimeType: 'text/plain',
            size: 1,
            downloadUrl: '',
          },
        ],
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
      expect(updateConversationMock.mock.invocationCallOrder[0]).toBeLessThan(sendMessageMock.mock.invocationCallOrder[0]);
    });
  });

  it('persists a prompt-bar workspace selection before the next message', async () => {
    render(<ConversationInput conversationId='conv-1' />);

    await userEvent.click(screen.getByRole('button', { name: 'select-workspace' }));

    await waitFor(() => {
      expect(updateConversationMock).toHaveBeenCalledWith('conv-1', { workspaces: ['ws-2'] });
    });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('waits for an in-flight workspace selection before sending a message', async () => {
    let resolveUpdate: () => void = () => undefined;
    updateConversationMock.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveUpdate = resolve;
    }));
    render(<ConversationInput conversationId='conv-1' />);

    await userEvent.click(screen.getByRole('button', { name: 'select-workspace' }));
    await userEvent.click(screen.getByRole('button', { name: 'submit-message' }));

    expect(sendMessageMock).not.toHaveBeenCalled();
    resolveUpdate();
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalled());
    expect(updateConversationMock.mock.invocationCallOrder[0]).toBeLessThan(sendMessageMock.mock.invocationCallOrder[0]);
  });

  it('serializes rapid workspace selections and persists the latest value', async () => {
    let resolveFirstUpdate: () => void = () => undefined;
    updateConversationMock
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveFirstUpdate = resolve;
      }))
      .mockResolvedValueOnce(undefined);
    render(<ConversationInput conversationId='conv-1' />);

    await userEvent.click(screen.getByRole('button', { name: 'select-workspace' }));
    await userEvent.click(screen.getByRole('button', { name: 'select-another-workspace' }));

    expect(updateConversationMock).toHaveBeenCalledTimes(1);
    resolveFirstUpdate();
    await waitFor(() => {
      expect(updateConversationMock).toHaveBeenNthCalledWith(2, 'conv-1', { workspaces: ['ws-3'] });
    });
  });

  it('rolls back the prompt-bar selection when persistence fails', async () => {
    updateConversationMock.mockRejectedValueOnce(new Error('update failed'));
    render(<ConversationInput conversationId='conv-1' />);

    await userEvent.click(screen.getByRole('button', { name: 'select-workspace' }));

    await waitFor(() => expect(workspaceSelectionMock.set).toHaveBeenLastCalledWith(['ws-1']));
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('hides the workspace selector for governed conversations', () => {
    currentConversationMock.value = { id: 'conv-1', workspaces: ['ws-1'], runtimeMode: 'governed' };

    render(<ConversationInput conversationId='conv-1' />);

    expect(screen.getByText('workspace-selector-hidden')).toBeInTheDocument();
  });

  it('submits reasoning effort only for an untagged standard turn', async () => {
    render(<ConversationInput conversationId='conv-1' />);

    expect(screen.getByRole('button', { name: 'input.reasoning.label' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'submit-with-reasoning' }));

    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ modelId: 'model-1', reasoningEffort: 'high' }),
    ));
  });

  it('omits reasoning effort for member and platform copilot turns', async () => {
    const { rerender } = render(<ConversationInput conversationId='conv-1' />);
    await userEvent.click(screen.getByRole('button', { name: 'submit-to-member' }));
    expect(sendMessageMock.mock.calls.at(-1)?.[1]).not.toHaveProperty('reasoningEffort');

    currentConversationMock.value = { id: 'conv-1', workspaces: ['ws-1'], runtimePurpose: 'platform_copilot' };
    rerender(<ConversationInput conversationId='conv-1' />);
    await userEvent.click(screen.getByRole('button', { name: 'submit-with-reasoning' }));
    expect(sendMessageMock.mock.calls.at(-1)?.[1]).not.toHaveProperty('reasoningEffort');
    expect(screen.queryByRole('button', { name: 'input.reasoning.label' })).not.toBeInTheDocument();
  });

  it('hides and omits reasoning effort when sticky tagged agents route the turn', async () => {
    currentConversationMock.value = { id: 'conv-1', workspaces: ['ws-1'], taggedAgentIds: ['agent-9'] };
    render(<ConversationInput conversationId='conv-1' />);

    expect(screen.queryByRole('button', { name: 'input.reasoning.label' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'submit-with-reasoning' }));

    await waitFor(() => expect(sendMessageMock.mock.calls.at(-1)?.[1]).not.toHaveProperty('reasoningEffort'));
  });
});

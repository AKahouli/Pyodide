import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConversationInput } from './ConversationInput';

const sendMessageMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const stopStreamMock = vi.hoisted(() => vi.fn());
const clearAllMock = vi.hoisted(() => vi.fn());

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
          undefined,
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
  ),
}));

vi.mock('@/modules/usage', () => ({
  useUsage: () => ({ status: { isLimitExceeded: false } }),
  UsageLimitBanner: () => <div>usage-banner</div>,
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

vi.mock('../store', () => ({
  useConversationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      sendMessage: sendMessageMock,
      stopStream: stopStreamMock,
      clearReplyingTo: vi.fn(),
      isStreaming: false,
    }),
  useIsAwaitingFirstChunk: () => false,
  useInputDisabled: () => false,
  useReplyingToMessage: () => null,
  useSelectedWorkspaceIds: () => [],
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
  it('submits message with uploaded files and clears upload state', async () => {
    render(<ConversationInput conversationId='conv-1' />);

    await userEvent.click(screen.getByRole('button', { name: 'submit-message' }));

    await waitFor(() => {
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
    });
  });
});

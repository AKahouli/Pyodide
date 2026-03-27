import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConversationInput } from './ConversationInput';

const sendMessageMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const stopStreamMock = vi.hoisted(() => vi.fn());
const clearAllMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ai-elements/input', () => ({
  default: ({ onSubmit }: { onSubmit: (message: { text: string }, modelId: string, agentIds?: string[]) => Promise<void> }) => (
    <button
      type='button'
      onClick={() => {
        void onSubmit({ text: 'hello' }, 'model-1', ['agent-1']);
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

vi.mock('../store', () => ({
  useConversationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      sendMessage: sendMessageMock,
      stopStream: stopStreamMock,
      isStreaming: false,
    }),
  useIsAwaitingFirstChunk: () => false,
  useInputDisabled: () => false,
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
      });
      expect(clearAllMock).toHaveBeenCalled();
    });
  });
});

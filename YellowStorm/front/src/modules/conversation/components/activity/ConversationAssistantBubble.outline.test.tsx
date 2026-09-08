import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationAssistantBubble } from './ConversationAssistantBubble';
import { initialConversationUiState, useConversationUiStore } from '../../uiStore';
import type { MessageComponent } from '../../types';

const mocks = vi.hoisted(() => ({
  getArtifactDownloadUrl: vi.fn(),
  openFileViewerFromUrlLoader: vi.fn(),
  showError: vi.fn(),
  redactSensitiveText: true,
}));

vi.mock('../../api', () => ({ getArtifactDownloadUrl: mocks.getArtifactDownloadUrl }));
vi.mock('@/modules/file-viewer', () => ({ openFileViewerFromUrlLoader: mocks.openFileViewerFromUrlLoader }));
vi.mock('@/lib/notifications', () => ({ showError: mocks.showError }));
vi.mock('../../hooks/useConversationSettings', () => ({
  useConversationSettings: () => ({ redactSensitiveText: mocks.redactSensitiveText }),
}));
vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

const toolActivityOnly: MessageComponent[] = [
  { id: 'tool-1', type: 'toolActivity', data: { toolName: 'run_code', displayKey: 'runCode', summary: 'Compare selected files', renderKind: 'run_code', status: 'completed', startedAt: '2026-08-27T10:01:00Z', completedAt: '2026-08-27T10:02:00Z', durationMs: 1400 } },
];

describe('ConversationAssistantBubble outline reconciliation', () => {
  beforeEach(() => {
    useConversationUiStore.setState({ ...initialConversationUiState });
  });

  it('publishes headings for the rendered answer', async () => {
    render(
      <ConversationAssistantBubble
        conversationId='c1'
        messageId='m1'
        components={[{ id: 'text-1', type: 'text', data: { content: '# Heading One' } }]}
        isStreaming={false}
      />,
    );

    await waitFor(() => expect(useConversationUiStore.getState().outlineHeadingsByMessageId.m1).toHaveLength(1));
  });

  it('clears the snapshot when the answer is replaced by activity-only content', async () => {
    const { rerender } = render(
      <ConversationAssistantBubble
        conversationId='c1'
        messageId='m1'
        components={[{ id: 'text-1', type: 'text', data: { content: '# Heading One' } }]}
        isStreaming={false}
      />,
    );
    await waitFor(() => expect(useConversationUiStore.getState().outlineHeadingsByMessageId.m1).toHaveLength(1));

    rerender(
      <ConversationAssistantBubble
        conversationId='c1'
        messageId='m1'
        components={toolActivityOnly}
        isStreaming={false}
      />,
    );

    await waitFor(() => expect(useConversationUiStore.getState().outlineHeadingsByMessageId.m1).toEqual([]));
  });
});

import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { LiveAnswerBubble } from './LiveAnswerBubble';
import { initialRootWorkState, useRootWorkStore } from '../rootWorkStore';

vi.mock('@/modules/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string, args?: object) => key + (args ? JSON.stringify(args) : '') }) }));
vi.mock('../store', () => ({ useConversationStore: (selector: (state: unknown) => unknown) => selector({ stopStream: vi.fn(), sendMessage: vi.fn() }) }));
vi.mock('../uiStore', () => ({ useConversationUiStore: (selector: (state: unknown) => unknown) => selector({ setContextPanel: vi.fn() }) }));
vi.mock('./activity/ConversationAssistantBubble', () => ({ ConversationAssistantBubble: ({ workActivity }: { workActivity: ReactNode }) => <div>{workActivity}</div> }));
beforeEach(() => useRootWorkStore.setState(initialRootWorkState));

it('shows trusted temporary workers while the answer is still streaming', () => {
  useRootWorkStore.setState({ userId: 'owner', snapshots: { conversation: { epoch: 1, watermark: '0', stopRequestId: 'stop', jobs: [],
    foregroundWorkers: [{ executionId: 'worker', parentExecutionId: 'root', mode: 'foreground', role: 'temporary_worker',
      status: 'running', originAssistantMessageId: 'answer', task: 'Verify official documentation', createdAt: '', deadline: '' }],
  } } });
  render(<LiveAnswerBubble answer={{ conversationId: 'conversation', messageId: 'answer',
    components: [], createdAt: '', revision: 0 }} choiceInteractions={new Map()} />);
  expect(screen.getByText(/rootWork.temporaryWorker/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'input.stopReply' })).toBeVisible();
});

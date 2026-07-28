import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GovernanceDryRunConversationModal } from './GovernanceDryRunConversationModal';

const mocks = vi.hoisted(() => ({
  createDryRun: vi.fn(),
  setSelectedWorkspaceIds: vi.fn(),
  selectedWorkspaceIds: ['workspace-old'],
}));

vi.mock('@/components/ai-elements/input', () => ({
  default: ({ onSubmit }: { onSubmit: (message: { text: string }, modelId: string, agentIds?: string[], memberIds?: string[], workspaceIds?: string[]) => void }) => (
    <button type='button' onClick={() => onSubmit({ text: 'Test question' }, 'model', undefined, undefined, mocks.selectedWorkspaceIds)}>submit</button>
  ),
}));
vi.mock('@/components/ai-elements/chat-conversation', () => ({
  ChatConversation: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChatConversationContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChatConversationEmptyState: () => <div>empty</div>,
}));
vi.mock('@/modules/conversation/components/ConversationContent', () => ({ ConversationContent: () => <div>conversation</div> }));
vi.mock('@/modules/conversation/store', () => {
  const state = {
    setCurrentConversation: vi.fn().mockResolvedValue(undefined),
    fetchMessages: vi.fn().mockResolvedValue(undefined),
    clearMessages: vi.fn(),
    currentConversationId: null,
    isStreaming: false,
    streamingConversationId: null,
  };
  const useConversationStore = Object.assign((selector: (value: typeof state) => unknown) => selector(state), { setState: vi.fn() });
  return {
    useConversationStore,
    useSelectedWorkspaceIds: () => mocks.selectedWorkspaceIds,
    useSetSelectedWorkspaceIds: () => mocks.setSelectedWorkspaceIds,
  };
});
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../query/hooks', () => ({ useCreateGovernanceDryRun: () => ({ mutate: mocks.createDryRun, isPending: false }) }));
vi.mock('@/lib/notifications', () => ({ showError: vi.fn() }));

describe('GovernanceDryRunConversationModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectedWorkspaceIds = ['workspace-old'];
  });

  it('excludes workspace selections from a previous draft', async () => {
    render(
      <GovernanceDryRunConversationModal
        open
        onOpenChange={vi.fn()}
        deploymentId='deployment-1'
        programId='program-1'
        scopeId='scope-1'
        agentId='agent-1'
        scopedAgents={[]}
        scopedWorkspaces={[{ id: 'workspace-current', name: 'Current workspace', documentCount: 0 }]}
        initialWorkspaceIds={['workspace-current']}
        onDryRunCreated={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'submit' }));

    expect(mocks.setSelectedWorkspaceIds).toHaveBeenCalledWith(['workspace-current']);
    expect(mocks.createDryRun).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1', workspaceIds: ['workspace-current'] }),
      expect.any(Object),
    );
  });
});

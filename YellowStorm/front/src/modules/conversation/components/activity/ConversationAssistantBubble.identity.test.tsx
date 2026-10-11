import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationAssistantBubble } from './ConversationAssistantBubble';
import { useAgentStore } from '@/modules/agent/store';
import type { MessageComponent } from '../../types';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

const initial: MessageComponent = { id: 'initial', type: 'agentActivity', data: {
  summary: '', status: 'completed', actorId: 'root', actorName: 'Configured Root',
} };
const answer: MessageComponent = { id: 'answer', type: 'text', data: { content: 'Answer', actorId: 'root' } };
const workerTool: MessageComponent = { id: 'tool', type: 'toolActivity', data: {
  toolName: 'search', summary: '', status: 'completed', renderKind: 'search', actorName: 'Worker', actorId: 'worker',
} };

describe('answer producer header', () => {
  beforeEach(() => useAgentStore.setState({ agents: [], isInitialized: true }));

  it('shows the stored name while streaming and after reloading without a directory', () => {
    const props = { conversationId: 'c', messageId: 'm', components: [initial, answer] };
    const { rerender } = render(<ConversationAssistantBubble {...props} isStreaming />);
    expect(screen.getAllByText('Configured Root').length).toBeGreaterThan(0);
    rerender(<ConversationAssistantBubble {...props} isStreaming={false} />);
    expect(screen.getAllByText('Configured Root').length).toBeGreaterThan(0);
    expect(screen.queryByText('stream.activity.assistant')).not.toBeInTheDocument();
  });

  it('does not attribute the answer to a delegated tool worker', () => {
    render(<ConversationAssistantBubble conversationId='c' messageId='m' components={[initial, workerTool, answer]} isStreaming={false} />);
    expect(screen.getAllByText('Configured Root').length).toBeGreaterThan(0);
  });

  it('uses a different recorded text producer instead of the initial manager', () => {
    useAgentStore.setState({ agents: [{ id: 'worker', name: 'Answer Author' }] as never });
    render(<ConversationAssistantBubble conversationId='c' messageId='m' components={[initial, { ...answer, data: { content: 'Answer', actorId: 'worker' } }]} isStreaming={false} />);
    expect(screen.getAllByText('Answer Author').length).toBeGreaterThan(0);
    expect(screen.queryByText('Configured Root')).not.toBeInTheDocument();
  });

  it('uses the message agent id for older identified answers', () => {
    useAgentStore.setState({ agents: [{ id: 'known', name: 'Guide Agent' }] as never });
    render(<ConversationAssistantBubble conversationId='c' messageId='m' agentId='known' components={[{ ...answer, data: { content: 'Answer' } }]} isStreaming={false} />);
    expect(screen.getAllByText('Guide Agent').length).toBeGreaterThan(0);
  });

  it('does not guess a worker when the actual producer is unavailable', () => {
    render(<ConversationAssistantBubble conversationId='c' messageId='m' components={[workerTool, answer]} isStreaming={false} />);
    expect(screen.getAllByText('stream.activity.agentNameUnavailable').length).toBeGreaterThan(0);
    expect(screen.queryByText('Worker')).not.toBeInTheDocument();
  });

  it('loads an uncached historical producer name', async () => {
    const original = useAgentStore.getState().fetchAgents;
    const fetchAgents = vi.fn(async () => {
      useAgentStore.setState({ agents: [{ id: 'root', name: 'Historical Author' }] as never, isInitialized: true });
    });
    useAgentStore.setState({ agents: [], isInitialized: false, fetchAgents });
    try {
      render(<ConversationAssistantBubble conversationId='c' messageId='m' components={[answer]} isStreaming={false} />);
      await waitFor(() => expect(screen.getAllByText('Historical Author').length).toBeGreaterThan(0));
      expect(fetchAgents).toHaveBeenCalledOnce();
    } finally {
      useAgentStore.setState({ fetchAgents: original });
    }
  });

  it('shows a neutral label while a live reply has not named its agent yet', () => {
    render(<ConversationAssistantBubble conversationId='c' messageId='m' components={[]} isStreaming showWorking />);
    expect(screen.getAllByText('stream.activity.assistant').length).toBeGreaterThan(0);
    expect(screen.queryByText('stream.activity.agentNameUnavailable')).not.toBeInTheDocument();
  });

  it('labels unattributable old answers honestly', () => {
    render(<ConversationAssistantBubble conversationId='c' messageId='m' components={[workerTool, { ...answer, data: { content: 'Answer' } }]} isStreaming={false} />);
    expect(screen.getAllByText('stream.activity.agentNameUnavailable').length).toBeGreaterThan(0);
    expect(screen.queryByText('Worker')).not.toBeInTheDocument();
  });
});

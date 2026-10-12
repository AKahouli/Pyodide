import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationAssistantBubble } from '../activity/ConversationAssistantBubble';
import { useAgentStore } from '@/modules/agent/store';
import { preloadOpenUiForAgent } from './preload';
import type { MessageComponent } from '../../types';

const rendererState = vi.hoisted(() => ({ shouldThrow: false, throwOn: null as null | ((content: string) => boolean) }));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));
vi.mock('./preload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./preload')>();
  return { ...actual, preloadOpenUiForAgent: vi.fn(actual.preloadOpenUiForAgent) };
});
vi.mock('./OpenUiRenderer', () => ({
  default: ({ content, isStreaming }: { content: string; isStreaming: boolean }) => {
    if (rendererState.shouldThrow || rendererState.throwOn?.(content)) throw new Error('renderer crashed');
    return <div data-testid='openui-stub' data-streaming={String(isStreaming)}>{content}</div>;
  },
}));

const program = 'root = Stack([title])\ntitle = TextContent("Hello")';
const answer: MessageComponent = { id: 'answer', type: 'text', data: { content: program, actorId: 'agent-1' } };
const bubble = (isStreaming = false) => <ConversationAssistantBubble conversationId='c' messageId='m' components={[answer]} isStreaming={isStreaming} />;

describe('answer render mode', () => {
  beforeEach(() => {
    rendererState.shouldThrow = false;
    rendererState.throwOn = null;
    vi.stubEnv('VITE_OPENUI_RENDER_ENABLED', 'true');
    useAgentStore.setState({ agents: [{ id: 'agent-1', name: 'Generative UI agent', slug: 'research-assistant', genUiEnabled: true }] as never, isInitialized: true });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('renders the answer with OpenUI for an agent with generative UI on, whatever its slug', async () => {
    render(bubble());
    expect(await screen.findByTestId('openui-stub')).toHaveTextContent('root = Stack([title])');
  });

  it('passes the streaming flag through to the renderer', async () => {
    render(bubble(true));
    expect(await screen.findByTestId('openui-stub')).toHaveAttribute('data-streaming', 'true');
  });

  describe('live (streaming) reply', () => {
    const liveBubble = (components: MessageComponent[]) => (
      <ConversationAssistantBubble conversationId='c' messageId='m' components={components} isStreaming agentId='agent-1' agentName='OpenUI Experiment' showWorking={components.length === 0} />
    );
    const liveText = (content: string): MessageComponent => ({ id: 'live', type: 'text', data: { content } });

    it('warms the OpenUI chunk as soon as the stream start names a generative UI agent', () => {
      render(liveBubble([]));
      expect(preloadOpenUiForAgent).toHaveBeenCalledWith(expect.objectContaining({ genUiEnabled: true }));
    });

    it('renders the growing reply through OpenUI with isStreaming, never through markdown', async () => {
      const { rerender } = render(liveBubble([liveText('root = Stack([a')]));
      expect(await screen.findByTestId('openui-stub')).toHaveAttribute('data-streaming', 'true');
      rerender(liveBubble([liveText('root = Stack([a])\na = TextContent(\"Hel')]));
      rerender(liveBubble([liveText('not even a program yet )(')]));
      const stub = screen.getByTestId('openui-stub');
      expect(stub).toHaveAttribute('data-streaming', 'true');
      expect(stub).toHaveTextContent('not even a program yet )(');
    });
  });

  it('keeps markdown for an agent with generative UI off, even with an openui- slug', () => {
    useAgentStore.setState({ agents: [{ id: 'agent-1', name: 'Regular', slug: 'openui-lookalike', genUiEnabled: false }] as never });
    render(bubble());
    expect(screen.queryByTestId('openui-stub')).not.toBeInTheDocument();
    expect(screen.getByText(/root = Stack/)).toBeInTheDocument();
  });

  it('still renders a stored OpenUI program for an agent whose toggle was switched off later', async () => {
    useAgentStore.setState({ agents: [{ id: 'agent-1', name: 'Regular', slug: 'regular', genUiEnabled: false }] as never });
    const stored: MessageComponent = { id: 'answer', type: 'text', data: { content: 'root = Card([title])\ntitle = TextContent("Hello")', actorId: 'agent-1' } };
    render(<ConversationAssistantBubble conversationId='c' messageId='m' components={[stored]} isStreaming={false} />);
    expect(await screen.findByTestId('openui-stub')).toHaveTextContent('root = Card([title])');
  });

  it('keeps markdown when the feature flag is off', () => {
    vi.stubEnv('VITE_OPENUI_RENDER_ENABLED', 'false');
    render(bubble());
    expect(screen.queryByTestId('openui-stub')).not.toBeInTheDocument();
    expect(screen.getByText(/root = Stack/)).toBeInTheDocument();
  });

  it('falls back to the markdown answer when the OpenUI renderer crashes', async () => {
    rendererState.shouldThrow = true;
    // React logs the caught render error; keep the test output clean.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      render(bubble());
      await waitFor(() => expect(screen.getByText(/root = Stack/)).toBeInTheDocument());
      expect(screen.queryByTestId('openui-stub')).not.toBeInTheDocument();
      // The markdown view is tagged with its stored component, so copy/export can tell it from a rendered answer.
      expect(document.querySelector('[data-openui-fallback="answer"]')).not.toBeNull();
    } finally {
      consoleError.mockRestore();
    }
  });

  describe('crash recovery', () => {
    const partial = 'root = Stack([a])\na = TextContent("half';
    const liveBubble = (content: string, isStreaming: boolean) => (
      <ConversationAssistantBubble conversationId='c' messageId='m' components={[{ id: 'a', type: 'text', data: { content, actorId: 'agent-1' } }]} isStreaming={isStreaming} />
    );

    it('never shows the raw program while streaming and renders OpenUI once the final program works', async () => {
      rendererState.throwOn = (content) => content === partial;
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const { rerender } = render(liveBubble(partial, true));
        await waitFor(() => expect(consoleError).toHaveBeenCalled());
        expect(screen.queryByTestId('openui-stub')).not.toBeInTheDocument();
        expect(screen.queryByText(/root = Stack/)).not.toBeInTheDocument();
        rerender(liveBubble(`${partial} text")`, true));
        expect(await screen.findByTestId('openui-stub')).toBeInTheDocument();
        rerender(liveBubble(`${partial} text")`, false));
        expect(screen.getByTestId('openui-stub')).toHaveAttribute('data-streaming', 'false');
      } finally {
        consoleError.mockRestore();
      }
    });

    it('retries once streaming ends and falls back to markdown only if the complete program still crashes', async () => {
      rendererState.throwOn = () => true;
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const { rerender } = render(liveBubble(partial, true));
        await waitFor(() => expect(consoleError).toHaveBeenCalled());
        expect(screen.queryByText(/root = Stack/)).not.toBeInTheDocument();
        rerender(liveBubble(partial, false));
        expect(await screen.findByText(/root = Stack/)).toBeInTheDocument();
        expect(screen.queryByTestId('openui-stub')).not.toBeInTheDocument();
      } finally {
        consoleError.mockRestore();
      }
    });

    it('recovers when the crash was only on the last streamed chunk', async () => {
      let attempts = 0;
      rendererState.throwOn = () => attempts++ === 0;
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const { rerender } = render(liveBubble(partial, true));
        await waitFor(() => expect(attempts).toBeGreaterThan(0));
        rerender(liveBubble(partial, false));
        expect(await screen.findByTestId('openui-stub')).toBeInTheDocument();
      } finally {
        consoleError.mockRestore();
      }
    });
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationAssistantBubble } from '../activity/ConversationAssistantBubble';
import { useAgentStore } from '@/modules/agent/store';
import { preloadOpenUiForAgent } from './preload';
import type { MessageComponent, OpenUiSubmission } from '../../types';
import { useConversationStore } from '../../store';
import type { ActionEvent } from '@openuidev/react-lang';
import { OpenUiAnswer } from './OpenUiAnswer';

const rendererState = vi.hoisted(() => ({ shouldThrow: false, throwOn: null as null | ((content: string) => boolean), action: null as ActionEvent | null }));
const downloads = vi.hoisted(() => ({ sign: vi.fn(), save: vi.fn(), error: vi.fn() }));
vi.mock('../../api', async (importOriginal) => ({ ...await importOriginal<typeof import('../../api')>(), getArtifactDownloadUrl: downloads.sign, downloadArtifactFile: downloads.save }));
vi.mock('@/lib/notifications', () => ({ showError: downloads.error }));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));
vi.mock('./preload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./preload')>();
  return { ...actual, preloadOpenUiForAgent: vi.fn(actual.preloadOpenUiForAgent) };
});
vi.mock('./OpenUiRenderer', () => ({
  default: ({ content, isStreaming, onAction, citationScope, initialState }: { content: string; isStreaming: boolean; onAction: (event: ActionEvent) => void; citationScope?: { componentId?: string }; initialState?: Record<string, unknown> }) => {
    if (rendererState.shouldThrow || rendererState.throwOn?.(content)) throw new Error('renderer crashed');
    return <div data-testid='openui-stub' data-streaming={String(isStreaming)} data-state={JSON.stringify(initialState)} data-component-id={citationScope?.componentId}>{content}{rendererState.action && <button onClick={() => onAction(rendererState.action!)}>Download test</button>}</div>;
  },
}));

const program = 'root = Stack([title])\ntitle = TextContent("Hello")';
const answer: MessageComponent = { id: 'answer', type: 'text', data: { content: program, actorId: 'agent-1' } };
const originalSend = useConversationStore.getState().sendMessage;
const bubble = (isStreaming = false) => <ConversationAssistantBubble conversationId='c' messageId='m' components={[answer]} isStreaming={isStreaming} />;

describe('answer render mode', () => {
  it('propagates the saved answer part identity to image and citation actions', async () => {
    render(<OpenUiAnswer conversationId='conversation' messageId='answer' partId='part-b' content={program} isStreaming={false} />);
    expect(await screen.findByTestId('openui-stub')).toHaveAttribute('data-component-id', 'part-b');
  });
  beforeEach(() => {
    rendererState.shouldThrow = false;
    rendererState.throwOn = null;
    rendererState.action = null;
    vi.clearAllMocks();
    useConversationStore.setState({ messages: [], isStreaming: false, currentConversationId: null, sendMessage: originalSend });
    vi.stubEnv('VITE_OPENUI_RENDER_ENABLED', 'true');
    useAgentStore.setState({ agents: [{ id: 'agent-1', name: 'Generative UI agent', slug: 'research-assistant', genUiEnabled: true }] as never, isInitialized: true });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('preserves typed form state, blocks concurrent duplicate submits and restores accepted values on remount', async () => {
    const formState = { filters: { count: { value: 0, componentType: 'Slider' }, enabled: { value: false, componentType: 'SwitchItem' }, notes: { value: '', componentType: 'TextArea' } } };
    rendererState.action = { type: 'continue_conversation', params: { row: 0 }, humanFriendlyMessage: 'Apply', formName: 'filters', formState };
    let finish!: () => void;
    const send = vi.fn().mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    useConversationStore.setState({ sendMessage: send });
    const props = { content: program, isStreaming: false, conversationId: 'c', messageId: 'm', partId: 'part' };
    const view = render(<OpenUiAnswer {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download test' }));
    fireEvent.click(screen.getByRole('button', { name: 'Download test' }));
    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][1];
    expect(payload.openUiSubmission).toMatchObject({ type: 'openui', componentId: 'part', sourceMessageId: 'm', formName: 'filters', formState, params: { row: 0 } });
    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download test' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Download test' }));
    expect(send).toHaveBeenCalledTimes(1);
    view.unmount();
    useConversationStore.setState({ messages: [{ id: 'saved', conversationId: 'c', conversationType: 'user', interaction: payload.openUiSubmission as OpenUiSubmission, createdAt: '2026-10-16' }] });
    render(<OpenUiAnswer {...props} />);
    expect(JSON.parse((await screen.findByTestId('openui-stub')).getAttribute('data-state')!)).toEqual(formState);
    fireEvent.click(screen.getByRole('button', { name: 'Download test' }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retains values and reuses the request ID when a rejected submission is retried', async () => {
    rendererState.action = { type: 'continue_conversation', params: {}, humanFriendlyMessage: 'Apply', formName: 'filters', formState: { active: false } };
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    useConversationStore.setState({ sendMessage: send });
    render(<OpenUiAnswer content={program} isStreaming={false} conversationId='c' messageId='m' partId='part' />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download test' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Download test' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[0][1].requestId).toBe(send.mock.calls[1][1].requestId);
    expect(send.mock.calls[1][1].openUiSubmission.formState).toEqual({ active: false });
  });

  it('signs the matching answer artifact on every click after remount and reports delivery errors', async () => {
    rendererState.action = { type: 'download_artifact', params: { filename: 'report.docx' }, humanFriendlyMessage: '' };
    downloads.sign.mockResolvedValue({ downloadUrl: 'https://signed.test/object' });
    downloads.save.mockResolvedValue(undefined);
    const props = { content: program, isStreaming: false, conversationId: 'c', messageId: 'm', artifacts: [{ artifactId: 'a', filename: 'report.docx', availability: 'ready' as const }] };
    const first = render(<OpenUiAnswer {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download test' }));
    await waitFor(() => expect(downloads.save).toHaveBeenCalledWith('https://signed.test/object', 'report.docx'));
    expect(downloads.sign).toHaveBeenCalledWith('c', 'm', 'a');
    first.unmount();
    downloads.sign.mockRejectedValueOnce(new Error('Denied'));
    render(<OpenUiAnswer {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download test' }));
    await waitFor(() => expect(downloads.error).toHaveBeenCalledWith('stream.activity.artifactError'));
    expect(downloads.sign).toHaveBeenCalledTimes(2);
    expect(downloads.save).toHaveBeenCalledTimes(1);
  });

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

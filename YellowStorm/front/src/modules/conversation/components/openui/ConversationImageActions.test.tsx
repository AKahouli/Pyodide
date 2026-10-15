import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationImageActions } from './ConversationImageActions';
import { OpenUiCitationContext } from './citations';
import en from '../../locales/en.json';

const fixture = vi.hoisted(() => ({
  sendMessage: vi.fn().mockResolvedValue(undefined),
  conversation: { id: 'conversation', rootAgentId: 'agent', runtimeMode: 'standard' },
  streaming: false,
  agents: [{ id: 'agent', isActive: true, tools: ['image-tool'], connectors: ['interpreter'] }],
  messages: [{ id: 'answer', conversationId: 'conversation', conversationType: 'ai', modelId: 'vision-model', components: [{ id: 'part-a', type: 'text', data: { actorId: 'agent', content: '[1] generated-image:123456789012345678901234' } }] }],
  tools: [{ id: 'image-tool', name: 'generate_image' }],
  connectors: [{ id: 'interpreter', slug: 'configured-office-runtime', actions: [
    { key: 'shell_exec', isEnabled: true }, { key: 'send_file_to_user', isEnabled: true },
  ] }],
  getTools: vi.fn(), getConnectors: vi.fn(),
  imageClose: vi.fn(),
}));
vi.mock('@/modules/agent/api', () => ({ getActiveTools: () => fixture.getTools(), getActiveConnectors: () => fixture.getConnectors() }));
vi.mock('@/modules/agent/store', () => ({ useAgentStore: Object.assign((selector: (state: unknown) => unknown) => selector({ agents: fixture.agents, isInitialized: true }), { getState: () => ({ agents: fixture.agents, fetchAgents: vi.fn() }) }) }));
vi.mock('../../store', () => ({ useConversationStore: Object.assign((selector: (state: unknown) => unknown) => selector({ currentConversation: fixture.conversation, isStreaming: fixture.streaming, messages: fixture.messages }), { getState: () => ({ currentConversation: fixture.conversation, isStreaming: fixture.streaming, sendMessage: fixture.sendMessage }) }) }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: keyof typeof en, values?: Record<string, string>) => Object.entries(values ?? {}).reduce((text, [name, value]) => text.replaceAll(`{{${name}}}`, value), en[key] ?? key) }) }));

beforeEach(() => {
  vi.clearAllMocks(); fixture.conversation = { id: 'conversation', rootAgentId: 'agent', runtimeMode: 'standard' };
  fixture.streaming = false;
  fixture.agents = [{ id: 'agent', isActive: true, tools: ['image-tool'], connectors: ['interpreter'] }];
  fixture.messages[0].components = [{ id: 'part-a', type: 'text', data: { actorId: 'agent', content: '[1] generated-image:123456789012345678901234' } }];
  fixture.getTools.mockResolvedValue(fixture.tools); fixture.getConnectors.mockResolvedValue(fixture.connectors);
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4800, height: 3200, close: fixture.imageClose }));
});
afterEach(() => vi.unstubAllGlobals());

function show(source = 'generated-image:123456789012345678901234', componentId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const scope = { conversationId: 'conversation', messageId: 'answer', componentId };
  return render(<QueryClientProvider client={client}><OpenUiCitationContext.Provider value={{ scope, byReference: new Map([['1', { fileName: 'original.pdf', source: 'private/path/original.pdf', page: 'Page 3' } as never]]) }}>
    <ConversationImageActions source={source} alt='Image' scope={scope} url='blob:image' resolveImage={vi.fn().mockResolvedValue(new Blob(['image'], { type: 'image/png' }))} />
  </OpenUiCitationContext.Provider></QueryClientProvider>);
}

describe('Conversation image action integration', () => {
  it('routes a selected PDF page through the existing conversation sender using its exact filename', async () => {
    show('[1]');
    expect(screen.getByText('Editing and document reuse process PDF page 3, including content outside the preview crop.')).toBeInTheDocument();
    const edit = await screen.findByRole('button', { name: 'Edit image' });
    await waitFor(() => expect(edit).toBeEnabled()); fireEvent.click(edit);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Add a sun' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate edited image' }));
    await waitFor(() => expect(fixture.sendMessage).toHaveBeenCalledTimes(1));
    expect(fixture.sendMessage).toHaveBeenCalledWith('conversation', { content: expect.stringContaining('sourceImage="original.pdf", sourcePage=3'), agentIds: ['agent'], parentMessageId: 'answer', modelId: 'vision-model' });
    expect(fixture.sendMessage.mock.calls[0][1].content).not.toContain('private/path');
    expect(fixture.sendMessage.mock.calls[0][1].content).toContain('aspectRatio="landscape"');
    expect(fixture.imageClose).toHaveBeenCalledOnce();
  });

  it.each(['governed', 'wrong-conversation', 'missing-tool', 'streaming'])('disables image editing for %s', async (mode) => {
    if (mode === 'governed') fixture.conversation.runtimeMode = 'governed';
    if (mode === 'wrong-conversation') fixture.conversation.id = 'another';
    if (mode === 'missing-tool') fixture.agents[0].tools = [];
    if (mode === 'streaming') fixture.streaming = true;
    show(); await waitFor(() => expect(screen.getByRole('button', { name: 'Edit image' })).toBeDisabled());
    expect(fixture.sendMessage).not.toHaveBeenCalled();
  });

  it('surfaces catalog errors and never sends a request', async () => {
    fixture.getTools.mockRejectedValue(new Error('denied')); show();
    expect(await screen.findByText('Image editing capabilities are unavailable for this agent.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit image' })).toBeDisabled();
    expect(fixture.sendMessage).not.toHaveBeenCalled();
  });

  it('keeps slide reuse available without granting Office reuse when the interpreter is unassigned', async () => {
    fixture.agents[0].connectors = [];
    const user = userEvent.setup(); show();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reuse image' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Reuse image' }));
    expect(await screen.findByRole('menuitem', { name: 'Create Word document' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: 'Create editable PowerPoint' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: 'Create slides' })).not.toHaveAttribute('aria-disabled');
  });

  it('routes edits back to the producing agent and model rather than another group agent', async () => {
    fixture.conversation.rootAgentId = 'another-agent';
    fixture.agents.push({ id: 'another-agent', isActive: true, tools: [], connectors: [] });
    show(); await waitFor(() => expect(screen.getByRole('button', { name: 'Edit image' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Edit image' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Add a tree' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate edited image' }));
    await waitFor(() => expect(fixture.sendMessage).toHaveBeenCalledWith('conversation', expect.objectContaining({ agentIds: ['agent'], parentMessageId: 'answer', modelId: 'vision-model' })));
  });

  it('does not guess a default agent when the producing owner is unavailable', async () => {
    fixture.messages[0].components[0].data.actorId = 'unknown-owner'; show();
    expect(screen.getByRole('button', { name: 'Edit image' })).toBeDisabled();
    expect(fixture.sendMessage).not.toHaveBeenCalled();
  });

  it('uses the assigned interpreter capabilities instead of a tenant-specific slug', async () => {
    const user = userEvent.setup(); show();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reuse image' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Reuse image' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Create Word document' }));
    expect(fixture.sendMessage).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Create Word document' }));
    await waitFor(() => expect(fixture.sendMessage).toHaveBeenCalledTimes(1));
    expect(fixture.sendMessage.mock.calls[0][1].content).toContain('"configured-office-runtime"');
  });

  it('uses the clicked part producer when two agents share the same citation selector', async () => {
    fixture.agents.push({ id: 'second-agent', isActive: true, tools: ['image-tool'], connectors: ['interpreter'] });
    fixture.messages[0].components.push({ id: 'part-b', type: 'text', data: { actorId: 'second-agent', content: '[1]' } });
    show('[1]', 'part-b');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit image' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Edit image' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Make it blue' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate edited image' }));
    await waitFor(() => expect(fixture.sendMessage).toHaveBeenCalledWith('conversation', expect.objectContaining({ agentIds: ['second-agent'], parentMessageId: 'answer' })));
  });

  it('disables ambiguous image owners when part identity is missing', async () => {
    fixture.messages[0].components.push({ id: 'part-b', type: 'text', data: { actorId: 'second-agent', content: '[1]' } });
    show('[1]');
    expect(screen.getByRole('button', { name: 'Edit image' })).toBeDisabled();
    expect(fixture.sendMessage).not.toHaveBeenCalled();
  });
});

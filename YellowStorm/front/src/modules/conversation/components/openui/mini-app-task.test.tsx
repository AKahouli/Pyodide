import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OpenUiRenderer from './OpenUiRenderer';
import { MiniAppTaskContext, findMiniAppTask } from './mini-app-task-context';
import { fetchConversationFiles, fetchMessage } from '../../api';
import { useConversationStore } from '../../store';
import type { Message } from '../../types';
import { miniAppCompositionExamples } from './mini-app-examples';

vi.mock('../../api', async original => ({ ...await original<typeof import('../../api')>(), fetchConversationFiles: vi.fn(), fetchMessage: vi.fn() }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }) }));
const id = '1'.repeat(24); const scope = { conversationId: 'conversation', actorId: 'actor', messageId: 'source', componentId: 'part', programDigest: 'd'.repeat(64), stateRevision: 2, dirty: false, cancel: vi.fn().mockResolvedValue(undefined) };
const program = `root = Card([app])
$document = "${id}"
$length = "short"
app = MiniApp("reader", "Document reader", "Read a selected document", [layout])
layout = MiniPanel([grid], "outline")
grid = MiniGrid([doc, length, run, result], 2, 240)
doc = MiniDocument("document", "Document", $document, true)
length = MiniSelect("length", "Length", $length, [{value: "short", label: "Short"}, {value: "long", label: "Long"}])
run = MiniButton("Read", Action([@AskAgent("Summarize the document", {documentId: $document, length: $length}, [$document])]), true)
result = MiniTaskResult("Result", {documentId: $document, length: $length})`;
const question = (): Message => ({ id: 'question', senderId: scope.actorId, conversationId: scope.conversationId, conversationType: 'user', createdAt: '2026-10-17', answerMessageId: 'answer',
  interaction: { type: 'openui', schemaVersion: 1, sourceMessageId: scope.messageId, componentId: scope.componentId, actionType: 'continue_conversation', formName: 'reader', formState: {},
    params: { instruction: 'Summarize', inputs: { documentId: id, length: 'short' } }, appTask: { schemaVersion: 1, programDigest: scope.programDigest, stateRevision: 2, documentIds: [id] } } });
const answer = (status: Message['terminalStatus'] = 'completed'): Message => ({ id: 'answer', conversationId: scope.conversationId, conversationType: 'ai', questionMessageId: 'question', createdAt: '2026-10-17', isComplete: true, terminalStatus: status,
  components: [{ id: 'summary', type: 'text', data: { content: 'Project Birch starts Friday with a zero euro budget.' } }] });
const mount = (onAction = vi.fn()) => render(<MiniAppTaskContext.Provider value={scope}><OpenUiRenderer content={program} isStreaming={false} onAction={onAction} /></MiniAppTaskContext.Provider>);

describe('generic mini-app document tasks', () => {
  it('validates the generation summarizer and restores its actual saved result without rerunning', async () => {
    const user = userEvent.setup(); const onAction = vi.fn();
    const props = { content: miniAppCompositionExamples.summarizer, isStreaming: false, onAction };
    const view = render(<MiniAppTaskContext.Provider value={scope}><OpenUiRenderer {...props} /></MiniAppTaskContext.Provider>);
    expect(await screen.findByRole('button', { name: 'Summarize' })).toBeDisabled();
    await screen.findByRole('option', { name: 'brief.pdf' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Conversation document' }), id);
    await user.click(screen.getByRole('button', { name: 'Summarize' }));
    expect(onAction.mock.calls[0][0]).toMatchObject({ type: 'AskAgent', formName: 'summarizer', params: {
      inputs: { documentId: id, length: 'short' }, documentIds: [id],
    } });
    const saved = question();
    if (saved.interaction?.type === 'openui') saved.interaction.formName = 'summarizer';
    useConversationStore.setState({ messages: [saved, answer()] }); view.unmount(); onAction.mockClear();
    render(<MiniAppTaskContext.Provider value={scope}><OpenUiRenderer {...props} initialState={{ $document: id, $length: 'short' }} /></MiniAppTaskContext.Provider>);
    await screen.findByText('Project Birch starts Friday with a zero euro budget.');
    expect(onAction).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Summary length' }), 'detailed');
    await screen.findByText('openui.task.stale');
  });
  beforeEach(() => {
    vi.clearAllMocks(); useConversationStore.setState({ messages: [] });
    vi.mocked(fetchConversationFiles).mockResolvedValue({ documents: [
      { id, originalName: 'brief.pdf', status: 'completed' }, { id: '2'.repeat(24), originalName: 'pending.docx', status: 'pending' },
      { id: '3'.repeat(24), originalName: 'folder', status: 'completed', isFolder: true },
    ] as never, pagination: { page: 1, limit: 50, total: 3, totalPages: 1 } });
  });
  it('lists completed authorized files and sends typed IDs only on an explicit click', async () => {
    const user = userEvent.setup(); const onAction = vi.fn(); mount(onAction);
    await screen.findByRole('option', { name: 'brief.pdf' });
    expect(screen.queryByRole('option', { name: 'pending.docx' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'folder' })).not.toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Read' }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(onAction.mock.calls[0][0]).toMatchObject({ type: 'AskAgent', params: { documentIds: [id], inputs: { documentId: id, length: 'short' } } });
  });
  it('restores the linked result on remount without agent action and hides it for changed inputs', async () => {
    const user = userEvent.setup(); const onAction = vi.fn(); useConversationStore.setState({ messages: [question(), answer()] });
    const view = mount(onAction); await screen.findByText('Project Birch starts Friday with a zero euro budget.');
    view.unmount(); mount(onAction); await screen.findByText('Project Birch starts Friday with a zero euro budget.');
    expect(onAction).not.toHaveBeenCalled(); expect(fetchMessage).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Length' }), 'long');
    await screen.findByText('openui.task.stale');
    expect(screen.queryByText('Project Birch starts Friday with a zero euro budget.')).not.toBeInTheDocument();
  });
  it.each(['cancelled', 'failed', 'interrupted'] as const)('does not present partial %s output as a completed result', async status => {
    useConversationStore.setState({ messages: [question(), answer(status)] }); mount();
    await screen.findByText(`openui.task.${status === 'cancelled' ? 'cancelled' : 'error'}`);
    expect(screen.queryByText('Project Birch starts Friday with a zero euro budget.')).not.toBeInTheDocument();
  });
  it('loads a missing saved answer through the authenticated read API, never execution', async () => {
    vi.mocked(fetchMessage).mockResolvedValue(answer()); useConversationStore.setState({ messages: [question()] });
    const onAction = vi.fn(); mount(onAction); await screen.findByText('Project Birch starts Friday with a zero euro budget.');
    expect(fetchMessage).toHaveBeenCalledWith(scope.conversationId, 'answer'); expect(onAction).not.toHaveBeenCalled();
  });
  it('offers targeted cancellation for a pending task', async () => {
    const user = userEvent.setup(); useConversationStore.setState({ messages: [question(), { ...answer('running'), isComplete: false }] }); mount();
    await user.click(await screen.findByRole('button', { name: 'openui.task.cancel' }));
    await waitFor(() => expect(scope.cancel).toHaveBeenCalledWith('answer'));
  });
  it('never correlates another actor, source, program or app result', () => {
    const message = question();
    expect(findMiniAppTask([message], scope, 'reader')).toBe(message);
    for (const patch of [{ actorId: 'other' }, { messageId: 'other' }, { componentId: 'other' }, { programDigest: 'e'.repeat(64) }, { conversationId: 'other' }]) {
      expect(findMiniAppTask([message], { ...scope, ...patch }, 'reader')).toBeUndefined();
    }
    expect(findMiniAppTask([message], scope, 'other')).toBeUndefined();
  });
  it('invalidates results by the host draft revision even when generated inputs omit a changed document', async () => {
    useConversationStore.setState({ messages: [question(), answer()] });
    render(<MiniAppTaskContext.Provider value={{ ...scope, stateRevision: 3 }}><OpenUiRenderer content={program} isStreaming={false} onAction={vi.fn()} /></MiniAppTaskContext.Provider>);
    await screen.findByText('openui.task.stale');
    expect(screen.queryByText('Project Birch starts Friday with a zero euro budget.')).not.toBeInTheDocument();
  });
});

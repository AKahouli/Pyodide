import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RootInputPanel as Panel } from './RootInputPanel';
import { useRootInputUiStore, initialRootInputUiState } from '../rootInputUiStore';
import { initialRootWorkState, useRootWorkStore } from '../rootWorkStore';
function RootInputPanel(props: { conversationId: string; creatorId: string }) { return <><Panel {...props} /><Panel {...props} variant='details' /></>; }
import { encodeNativeInput } from './NativeInputFields';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), send: vi.fn(), background: vi.fn(), user: { id: 'owner' } }));
vi.mock('../api', () => ({ fetchRootInputs: mocks.fetch, submitBackgroundRootInput: mocks.background }));
vi.mock('../store', () => ({ useConversationStore: (selector: (state: unknown) => unknown) => selector({ sendMessage: mocks.send }) }));
vi.mock('@/modules/auth/useAuth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));

describe('Native pending input', () => {
  beforeEach(() => { vi.clearAllMocks(); useRootInputUiStore.setState(initialRootInputUiState); useRootWorkStore.setState(initialRootWorkState); mocks.user.id = 'owner'; mocks.send.mockResolvedValue(undefined); });
  it('refreshes immediately after a lifecycle event without resetting the scoped draft', async () => {
    mocks.fetch.mockResolvedValue([{ executionId: 'execution', epoch: 2, inputs: [{ inputId: 'input', kind: 'input' }] }]);
    render(<RootInputPanel conversationId='conversation' creatorId='owner' />);
    await userEvent.type(await screen.findByRole('textbox'), 'Preserve this answer');
    const previousSignal = mocks.fetch.mock.calls[0][1] as AbortSignal;
    act(() => useRootWorkStore.getState().refresh());
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(2));
    expect(previousSignal.aborted).toBe(true);
    expect(screen.getByRole('textbox')).toHaveValue('Preserve this answer');
  });
  it('restores a submitted answer with an inline error on a correlated native failure', async () => {
    mocks.fetch.mockResolvedValue([{ executionId: 'execution', epoch: 2, inputs: [{ inputId: 'ask', kind: 'input' }] }]);
    mocks.send.mockImplementation(async (_conversation, _payload, accepted) => accepted('failed-message'));
    render(<RootInputPanel conversationId='conversation' creatorId='owner' />);
    await userEvent.type(await screen.findByRole('textbox', { name: 'rootInput.response' }), 'Keep my answer');
    await userEvent.click(screen.getByRole('button', { name: 'rootInput.continue' }));
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    act(() => useRootInputUiStore.getState().failContinuation('conversation', 'unrelated-message'));
    expect(screen.queryByRole('textbox')).toBeNull();
    act(() => useRootInputUiStore.getState().failContinuation('conversation', 'failed-message'));
    expect(screen.getByRole('textbox')).toHaveValue('Keep my answer');
    expect(screen.getByRole('alert')).toHaveTextContent('rootInput.continuationFailed');
    expect(screen.getByRole('button', { name: 'rootInput.continue' })).toBeEnabled();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('renders two inline questions at their own messages and binds only the chosen answer', async () => {
    const roots = ['first', 'second'].map((id) => ({ executionId: id, epoch: 2, originAssistantMessageId: `${id}-message`, inputs: [{
      inputId: 'input', inputVersion: 3, kind: 'input', message: `Question ${id}`, responseSchema: { type: 'object', properties: {
        chart_interval: { type: 'string', title: `${id} interval`, examples: ['Daily', '4-hour'] },
      }, required: ['chart_interval'] },
    }] }));
    mocks.fetch.mockResolvedValue(roots);
    render(<><Panel conversationId='conversation' creatorId='owner' />
      <Panel conversationId='conversation' creatorId='owner' messageId='first-message' variant='inline' />
      <Panel conversationId='conversation' creatorId='owner' messageId='second-message' variant='inline' />
      <Panel conversationId='conversation' creatorId='owner' variant='details' /></>);
    const field = await screen.findByRole('textbox', { name: 'second interval' });
    await userEvent.type(field, 'Weekly');
    fireEvent.submit(screen.getByRole('form', { name: 'Question second' }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith('conversation', {
      content: 'second interval: Weekly', rootContinuation: { executionId: 'second',
        inputResponses: [{ inputId: 'input', inputVersion: 3, response: { chart_interval: 'Weekly' } }] },
    }, expect.any(Function)));
    expect(screen.getByRole('textbox', { name: 'first interval' })).toBeEnabled();
    expect(screen.queryByRole('textbox', { name: 'second interval' })).toBeNull();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('queues a background approval without creating a foreground conversation turn', async () => {
    mocks.background.mockResolvedValue(undefined);
    mocks.fetch.mockResolvedValue([{ executionId: 'background-job', epoch: 2, mode: 'background',
      inputs: [{ inputId: 'approval', inputVersion: 3, kind: 'confirmation' }] }]);
    render(<RootInputPanel conversationId='conversation' creatorId='owner' />);
    await userEvent.click(await screen.findByRole('button', { name: 'rootInput.reject' }));
    expect(mocks.background).toHaveBeenCalledWith('conversation', 'background-job',
      [{ inputId: 'approval', inputVersion: 3, response: { confirmed: false } }]);
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('rejects through the existing continuation with a real false boolean', async () => {
    mocks.fetch.mockResolvedValue([{ executionId: 'execution', epoch: 2,
      inputs: [{ inputId: 'approval', kind: 'confirmation' }] }]);
    render(<RootInputPanel conversationId='conversation' creatorId='owner' />);
    await userEvent.click(await screen.findByRole('button', { name: 'rootInput.reject' }));
    expect(mocks.send).toHaveBeenCalledWith('conversation', {
      content: 'rootInput.rejected', rootContinuation: { executionId: 'execution',
        inputResponses: [{ inputId: 'approval', inputVersion: 1, response: { confirmed: false } }] },
    }, expect.any(Function));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'rootInput.reject' })).not.toBeInTheDocument());
  });
  it('preserves literal JSON-looking text in the native envelope', async () => {
    mocks.fetch.mockResolvedValue([{ executionId: 'execution', epoch: 2, inputs: [{
      inputId: 'input', kind: 'input', message: 'Value?', responseSchema: { type: 'string' },
    }] }]);
    render(<RootInputPanel conversationId='conversation' creatorId='owner' />);
    await userEvent.type(await screen.findByRole('textbox', { name: 'rootInput.response' }), 'true');
    await userEvent.click(screen.getByRole('button', { name: 'rootInput.continue' }));
    expect(mocks.send.mock.calls[0][1].rootContinuation.inputResponses).toEqual([
      { inputId: 'input', inputVersion: 1, response: { result: '"true"' } },
    ]);
  });
  it('uses ordinary text for a verified schema-free clarification', async () => {
    mocks.fetch.mockResolvedValue([{ executionId: 'execution', epoch: 2, inputs: [{
      inputId: 'input', kind: 'input', message: 'Your answer?',
    }] }]);
    render(<RootInputPanel conversationId='conversation' creatorId='owner' />);
    await userEvent.type(await screen.findByRole('textbox', { name: 'rootInput.response' }), 'plain answer');
    await userEvent.click(screen.getByRole('button', { name: 'rootInput.continue' }));
    expect(mocks.send.mock.calls[0][1].rootContinuation.inputResponses[0]).toEqual({
      inputId: 'input', inputVersion: 1, response: { result: '"plain answer"' },
    });
  });
  it('keeps a failed submission editable and never retries automatically', async () => {
    mocks.fetch.mockResolvedValue([{ executionId: 'execution', epoch: 2,
      inputs: [{ inputId: 'approval', kind: 'confirmation' }] }]);
    mocks.send.mockRejectedValue(new Error('offline'));
    render(<RootInputPanel conversationId='conversation' creatorId='owner' />);
    await userEvent.click(await screen.findByRole('button', { name: 'rootInput.approve' }));
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByRole('button', { name: 'rootInput.approve' })).toBeEnabled();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
  it('does not fetch or show execution inputs for another reader', () => {
    mocks.user.id = 'member';
    render(<RootInputPanel conversationId='conversation' creatorId='owner' />);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('shows unsupported formats as parked requests without a submit action', async () => {
    mocks.fetch.mockResolvedValue([{ executionId: 'execution', epoch: 2, inputs: [{
      inputId: 'input', kind: 'input', responseSchemaUnsupported: true,
    }] }]);
    render(<RootInputPanel conversationId='conversation' creatorId='owner' />);
    expect(await screen.findByText('rootInput.unsupportedFormat')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'rootInput.continue' })).not.toBeInTheDocument();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('shows a later request reusing the same input id and submits its current version', async () => {
    const snapshot = (version: number) => [{ executionId: 'execution', epoch: 2, inputs: [
      { inputId: 'same', inputVersion: version, kind: 'confirmation' },
    ] }];
    mocks.fetch.mockResolvedValueOnce(snapshot(1)).mockResolvedValueOnce(snapshot(2));
    render(<RootInputPanel conversationId='conversation' creatorId='owner' />);
    await userEvent.click(await screen.findByRole('button', { name: 'rootInput.reject' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'rootInput.reject' })).not.toBeInTheDocument());
    fireEvent.focus(window);
    await userEvent.click(await screen.findByRole('button', { name: 'rootInput.approve' }));
    expect(mocks.send.mock.calls[1][1].rootContinuation.inputResponses[0]).toEqual({
      inputId: 'same', inputVersion: 2, response: { confirmed: true },
    });
  });
  it('clears the old form immediately when the conversation changes', async () => {
    mocks.fetch.mockResolvedValueOnce([{ executionId: 'old', epoch: 2, inputs: [{ inputId: 'old', kind: 'confirmation' }] }]);
    const rendered = render(<RootInputPanel conversationId='old-conversation' creatorId='owner' />);
    await screen.findByRole('button', { name: 'rootInput.approve' });
    mocks.fetch.mockImplementation(() => new Promise(() => undefined));
    rendered.rerender(<RootInputPanel conversationId='new-conversation' creatorId='owner' />);
    expect(screen.queryByRole('button', { name: 'rootInput.approve' })).not.toBeInTheDocument();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('ignores a stale pending-input response after navigating away', async () => {
    let resolve: (result: unknown) => void = () => undefined;
    mocks.fetch.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const rendered = render(<RootInputPanel conversationId='conversation' creatorId='owner' />);
    const signal = mocks.fetch.mock.calls[0][1] as AbortSignal;
    rendered.unmount();
    resolve([{ executionId: 'old', epoch: 2, inputs: [{ inputId: 'old', kind: 'confirmation' }] }]);
    expect(signal.aborted).toBe(true);
    await waitFor(() => expect(screen.queryByRole('button')).not.toBeInTheDocument());
  });
  it('encodes scalar false/arrays and preserves ordinary objects', () => {
    expect(encodeNativeInput(false)).toEqual({ result: false });
    expect(encodeNativeInput(['one'])).toEqual({ result: ['one'] });
    expect(encodeNativeInput({ value: 'answer' })).toEqual({ value: 'answer' });
    expect(encodeNativeInput({ result: 'answer' })).toEqual({ result: { result: 'answer' } });
  });
  it('keeps dock compact, polls once and preserves the input draft when details close', async () => {
    mocks.fetch.mockResolvedValue([{ executionId: 'execution', epoch: 2, inputs: [{ inputId: 'input', kind: 'input' }] }]);
    const view = render(<><Panel conversationId='conversation' creatorId='owner' /><Panel conversationId='conversation' creatorId='owner' variant='details' /></>);
    const response = await screen.findByRole('textbox', { name: 'rootInput.response' });
    await userEvent.type(response, 'Keep this answer');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    view.rerender(<Panel conversationId='conversation' creatorId='owner' />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'rootInput.pendingCount' })).toBeInTheDocument();
    view.rerender(<><Panel conversationId='conversation' creatorId='owner' /><Panel conversationId='conversation' creatorId='owner' variant='details' /></>);
    expect(screen.getByRole('textbox', { name: 'rootInput.response' })).toHaveValue('Keep this answer');
  });
  it('keeps an in-flight response disabled when details reopen', async () => {
    mocks.fetch.mockResolvedValue([{ executionId: 'execution', epoch: 2, inputs: [{ inputId: 'approval', kind: 'confirmation' }] }]);
    mocks.send.mockImplementation(() => new Promise(() => undefined));
    const view = render(<><Panel conversationId='conversation' creatorId='owner' /><Panel conversationId='conversation' creatorId='owner' variant='details' /></>);
    await userEvent.click(await screen.findByRole('button', { name: 'rootInput.approve' }));
    view.rerender(<Panel conversationId='conversation' creatorId='owner' />);
    view.rerender(<><Panel conversationId='conversation' creatorId='owner' /><Panel conversationId='conversation' creatorId='owner' variant='details' /></>);
    expect(screen.getByRole('button', { name: 'rootInput.approve' })).toBeDisabled();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });
});

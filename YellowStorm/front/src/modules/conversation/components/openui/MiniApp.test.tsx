import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import OpenUiRenderer from './OpenUiRenderer';
import { miniAppExamples } from './mini-app-examples';
import { OpenUiSubmissionContext, toFollowUpMessage } from './actions';

describe('composed OpenUI mini-apps', () => {
  it('converts locally, distinguishes blank from zero and resets without an inference action', async () => {
    const user = userEvent.setup(); const onAction = vi.fn();
    render(<OpenUiRenderer content={miniAppExamples.converter} isStreaming={false} onAction={onAction} />);
    expect(await screen.findByLabelText('Fahrenheit')).toHaveTextContent('32.00');
    const input = screen.getByRole('spinbutton', { name: 'Celsius' });
    await user.clear(input);
    expect(screen.getByLabelText('Fahrenheit')).toHaveTextContent('openui.miniApp.emptyResult');
    await user.type(input, '100');
    expect(screen.getByLabelText('Fahrenheit')).toHaveTextContent('212.00');
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(input).toHaveValue(0);
    expect(screen.getByLabelText('Fahrenheit')).toHaveTextContent('32.00');
    expect(onAction).not.toHaveBeenCalled();
  });

  it('uses the same controls/functions for a scenario and a filterable list', async () => {
    const user = userEvent.setup(); const onAction = vi.fn();
    const view = render(<OpenUiRenderer content={miniAppExamples.scenario} isStreaming={false} onAction={onAction} />);
    expect(await screen.findByLabelText('Total')).toHaveTextContent('20.00');
    await user.click(screen.getByRole('checkbox', { name: 'Apply ten percent discount' }));
    expect(screen.getByLabelText('Total')).toHaveTextContent('18.00');
    await user.clear(screen.getByRole('spinbutton', { name: 'Unit price' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Unit price' }), '0');
    expect(screen.getByLabelText('Total')).toHaveTextContent('0.00');
    view.unmount();
    render(<OpenUiRenderer content={miniAppExamples.list} isStreaming={false} onAction={onAction} />);
    await user.type(await screen.findByRole('textbox', { name: 'Filter destinations' }), 'OS');
    expect(screen.getByRole('list')).toHaveTextContent('Osaka');
    expect(screen.queryByText('Tokyo')).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Filter destinations' }), 'zzz');
    expect(screen.getByText('No destinations match this filter.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('list')).toHaveTextContent('TokyoParisOsaka');
    expect(onAction).not.toHaveBeenCalled();
  });

  it('submits an explicit summarization instruction and exact typed values through the existing action contract', async () => {
    const user = userEvent.setup(); const onAction = vi.fn();
    render(<OpenUiRenderer content={miniAppExamples.summarizer} isStreaming={false} onAction={onAction} />);
    await user.type(await screen.findByRole('textbox', { name: 'Source text' }), 'The launch is Monday. Budget is zero.');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Summary length' }), 'detailed');
    await user.click(screen.getByRole('checkbox', { name: 'Use bullet points' }));
    expect(screen.getByLabelText('Text statistics')).toHaveTextContent('"words":7');
    expect(onAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Summarize' }));
    await waitFor(() => expect(onAction).toHaveBeenCalledOnce());
    const event = onAction.mock.calls[0][0];
    expect(event).toMatchObject({ type: 'AskAgent', formName: 'summarizer',
      params: { inputs: { sourceText: 'The launch is Monday. Budget is zero.', length: 'detailed', bullets: false } },
      formState: { $source: 'The launch is Monday. Budget is zero.', $length: 'detailed', $bullets: false } });
    const follow = toFollowUpMessage(event);
    expect(follow).toMatchObject({ kind: 'message', submission: { formName: 'summarizer', params: { inputs: { bullets: false } } } });
    expect(follow.kind === 'message' && follow.content).toContain('"bullets":false');
    expect(follow.kind === 'message' && follow.content).toContain('Summarize sourceText');
  });

  it('validates required and numeric ranges before an agent action', async () => {
    const user = userEvent.setup(); const onAction = vi.fn();
    const program = miniAppExamples.converter.replace('reset])', 'reset, send])')
      + '\nsend = MiniButton("Explain", Action([@AskAgent("Explain the conversion", {celsius: $celsius})]))';
    render(<OpenUiRenderer content={program} isStreaming={false} onAction={onAction} />);
    const input = await screen.findByRole('spinbutton', { name: 'Celsius' });
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'Explain' }));
    expect(input).toBeInvalid(); expect(onAction).not.toHaveBeenCalled();
    await user.type(input, '-300');
    await user.click(screen.getByRole('button', { name: 'Explain' }));
    expect(input).toBeInvalid(); expect(onAction).not.toHaveBeenCalled();
    await user.clear(input); await user.type(input, '0');
    await user.click(screen.getByRole('button', { name: 'Explain' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('hydrates accepted bindings, preserves zero/false and disables the whole panel while submitting or streaming', async () => {
    const props = { content: miniAppExamples.scenario, isStreaming: false, onAction: vi.fn(), initialState: { $price: 0, $quantity: 5, $discount: false } };
    const view = render(<OpenUiSubmissionContext.Provider value={{ scenario: 'submitting' }}><OpenUiRenderer {...props} /></OpenUiSubmissionContext.Provider>);
    expect(await screen.findByRole('spinbutton', { name: 'Unit price' })).toHaveValue(0);
    expect(screen.getByRole('spinbutton', { name: 'Unit price' })).toBeDisabled();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByLabelText('Total')).toHaveTextContent('0.00');
    view.rerender(<OpenUiSubmissionContext.Provider value={{ scenario: 'submitted' }}><OpenUiRenderer {...props} /></OpenUiSubmissionContext.Provider>);
    expect(screen.getByRole('spinbutton', { name: 'Unit price' })).toBeEnabled();
    expect(screen.getByText('openui.interaction.submitted')).toHaveAttribute('role', 'status');
    view.rerender(<OpenUiRenderer {...props} isStreaming />);
    expect(screen.getByRole('spinbutton', { name: 'Unit price' })).toBeDisabled();
  });

  it('rejects malformed or oversized agent requests instead of sending them', () => {
    expect(() => toFollowUpMessage({ type: 'AskAgent', humanFriendlyMessage: 'Run', params: { instruction: '', inputs: {} } })).toThrow();
    expect(() => toFollowUpMessage({ type: 'AskAgent', humanFriendlyMessage: 'Run', params: { instruction: 'Summarize', inputs: { text: 'x'.repeat(20001) } } })).toThrow();
    expect(() => toFollowUpMessage({ type: 'AskAgent', humanFriendlyMessage: 'Run', params: { instruction: 'Run', inputs: JSON.parse('{"__proto__":1}') } })).toThrow();
  });

  it('keeps a bad function result local to its output', async () => {
    render(<OpenUiRenderer content={'root = Card([bad, good])\nbad = MiniOutput("Invalid", @FormatNumber(1, 13))\ngood = MiniOutput("Valid", @FormatNumber(0, 2))'} isStreaming={false} onAction={vi.fn()} />);
    expect(await screen.findByLabelText('Invalid')).toHaveTextContent('openui.miniApp.emptyResult');
    expect(screen.getByLabelText('Valid')).toHaveTextContent('0.00');
  });
});

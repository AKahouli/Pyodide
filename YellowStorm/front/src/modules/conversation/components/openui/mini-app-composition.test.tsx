import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import OpenUiRenderer from './OpenUiRenderer';
import { miniAppExamples, miniAppCompositionExamples } from './mini-app-examples';
import { MiniGrid, MiniPanel, MiniRow } from './mini-app-definitions';

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }) }));

const keypad = `root = Card([app])
$number = 0
$left = 0
app = MiniApp("keypad", "Calculator", "Local arithmetic", [panel], "compact")
panel = MiniPanel([display, keys], "outline", 5, 4)
display = MiniOutput("Display", $number, "display", "end")
keys = MiniGrid([two, three, plus, equals], 2)
two = MiniButton("2", Action([@Set($number, $number * 10 + 2)]), false, "soft", "lg", null, false, true, "full")
three = MiniButton("3", Action([@Set($number, $number * 10 + 3)]), false, "soft", "lg", null, false, true, "full")
plus = MiniButton("Add", Action([@Set($left, $number), @Set($number, 0)]), false, "outline", "lg", "plus", false, true)
equals = MiniButton("Equals", Action([@Set($number, $left + $number)]), false, "solid", "lg", null, false, true)`;

describe('mini-app composition', () => {
  it('runs the generation keypad locally, restores state and recovers from division by zero', async () => {
    const user = userEvent.setup(); const onAction = vi.fn(); const update = vi.fn();
    const props = { content: miniAppCompositionExamples.calculator, isStreaming: false, onAction, onStateUpdate: update };
    const view = render(<OpenUiRenderer {...props} />);
    for (const name of ['2', '+', '3', '=']) await user.click(await screen.findByRole('button', { name }));
    expect(screen.getByLabelText('Result')).toHaveTextContent('5');
    const state = update.mock.calls.at(-1)![0]; view.unmount();
    render(<OpenUiRenderer {...props} initialState={state} />);
    expect(await screen.findByLabelText('Result')).toHaveTextContent('5');
    for (const name of ['÷', '0', '=']) await user.click(screen.getByRole('button', { name }));
    expect(update.mock.calls.at(-1)![0].$value).toBeNull();
    await user.click(screen.getByRole('button', { name: 'AC' }));
    expect(screen.getByLabelText('Result')).toHaveTextContent('0');
    expect(onAction).not.toHaveBeenCalled();
  });

  it.each(['scenario', 'planner'] as const)('keeps generated %s unsubmitted values on remount', async app => {
    const user = userEvent.setup(); const update = vi.fn(); const onAction = vi.fn();
    const props = { content: miniAppCompositionExamples[app], isStreaming: false, onAction, onStateUpdate: update };
    const view = render(<OpenUiRenderer {...props} />);
    if (app === 'scenario') {
      await user.clear(await screen.findByRole('spinbutton', { name: 'Unit price' }));
      await user.type(screen.getByRole('spinbutton', { name: 'Unit price' }), '0');
      await user.click(screen.getByRole('checkbox'));
    } else await user.type(await screen.findByRole('textbox'), 'osa');
    const state = update.mock.calls.at(-1)![0]; view.unmount();
    render(<OpenUiRenderer {...props} initialState={state} />);
    if (app === 'scenario') {
      expect(await screen.findByRole('spinbutton', { name: 'Unit price' })).toHaveValue(0);
      expect(screen.getByRole('checkbox')).toBeChecked();
      expect(screen.getByLabelText('Estimated total')).toHaveTextContent('0.00');
    } else {
      expect(await screen.findByRole('textbox')).toHaveValue('osa');
      expect(screen.getByRole('list')).toHaveTextContent('Osaka');
      expect(screen.queryByText('Tokyo')).not.toBeInTheDocument();
    }
    expect(onAction).not.toHaveBeenCalled();
  });

  it('keeps nested keypad actions local and restores typed state without dispatching an agent', async () => {
    const user = userEvent.setup(); const onAction = vi.fn(); const onStateUpdate = vi.fn();
    const view = render(<OpenUiRenderer content={keypad} isStreaming={false} onAction={onAction} onStateUpdate={onStateUpdate} />);
    await user.click(await screen.findByRole('button', { name: '2' }));
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('button', { name: '3' }));
    await user.click(screen.getByRole('button', { name: 'Equals' }));
    expect(screen.getByLabelText('Display')).toHaveTextContent('5');
    expect(onAction).not.toHaveBeenCalled();
    const state = onStateUpdate.mock.calls.at(-1)![0];
    expect(state.$number).toBe(5); expect(state.$left).toBe(2);
    view.unmount();
    render(<OpenUiRenderer content={keypad} isStreaming={false} onAction={onAction} initialState={state} />);
    expect(await screen.findByLabelText('Display')).toHaveTextContent('5');
    expect(onAction).not.toHaveBeenCalled();
  });

  it.each(['scenario', 'list', 'summarizer'] as const)('retains legacy %s bindings inside responsive groups', async app => {
    const program = miniAppExamples[app].replace(/app = MiniApp\(([^\n]+), \[([^\]]+)\]\)/, 'app = MiniApp($1, [layout])\nlayout = MiniPanel([grid], "soft")\ngrid = MiniGrid([$2], 2, 240)');
    const onAction = vi.fn(); render(<OpenUiRenderer content={program} isStreaming={false} onAction={onAction} />);
    expect(await screen.findByRole('form')).toBeInTheDocument();
    expect(document.querySelector('.ys-mini-grid')).toHaveStyle({ gridTemplateColumns: expect.stringContaining('auto-fit') });
    expect(onAction).not.toHaveBeenCalled();
    if (app === 'scenario') expect(screen.getByLabelText('Total')).toHaveTextContent('20.00');
    if (app === 'list') expect(screen.getByText('Tokyo')).toBeInTheDocument();
    if (app === 'summarizer') expect(screen.getByRole('button', { name: 'Summarize' })).toBeInTheDocument();
  });

  it('renders reactive text and bounded presentation props without exposing style strings', async () => {
    render(<OpenUiRenderer content={'root = Card([app])\n$value = "Ready"\napp = MiniApp("text", "Status", "", [row])\nrow = MiniRow([column])\ncolumn = MiniColumn([text])\ntext = MiniText($value, "heading", "end", "muted")'} isStreaming={false} onAction={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Ready' })).toHaveStyle({ textAlign: 'end' });
    expect(MiniGrid.props.safeParse({ children: [], columns: 100 }).success).toBe(false);
    expect(MiniPanel.props.safeParse({ children: [], surface: 'url(https://example.com)' }).success).toBe(false);
    expect(MiniRow.props.safeParse({ children: [], gap: -1 }).success).toBe(false);
  });
});

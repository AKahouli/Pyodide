import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import OpenUiRenderer from './OpenUiRenderer';
import { OpenUiSubmissionContext } from './actions';

export const interactiveProgram = `root = Card([filters, table])
filters = Form("filters", buttons, [city, enabled, budget])
budget = FormControl("Budget", Slider("budget", "Budget", "discrete", 0, 10, [0]))
city = FormControl("City", Input("city", {required: true}, "Choose a city"))
enabled = FormControl("Notifications", SwitchGroup("options", [SwitchItem("notify", "Notify me", "", false)]))
buttons = ButtonGroup([Button("Apply filters", {type: "continue_conversation", params: {selectedRow: 0, range: [0, 10]}}, "primary")])
table = Table([Col("City"), Col("Count", "number")], [["Paris", 0], ["Tokyo", 2]])`;

describe('interactive OpenUI forms', () => {
  it('validates required input and emits typed fields plus table/filter parameters', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(<OpenUiRenderer content={interactiveProgram} isStreaming={false} onAction={onAction} />);
    await user.click(await screen.findByRole('button', { name: 'Apply filters' }));
    expect(onAction).not.toHaveBeenCalled();
    await user.type(screen.getByPlaceholderText('Choose a city'), 'Paris');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(onAction).toHaveBeenCalledOnce());
    expect(onAction.mock.calls[0][0]).toMatchObject({ formName: 'filters', params: { selectedRow: 0, range: [0, 10] },
      formState: { filters: { city: { value: 'Paris', componentType: 'Input' }, notify: { value: false, componentType: 'SwitchItem' }, budget: { value: [0], componentType: 'Slider' } } } });
    expect(screen.getByRole('table')).toHaveTextContent('Tokyo');
  });

  it('hydrates saved values and keeps pending/submitted statuses visible', async () => {
    const props = { content: interactiveProgram, isStreaming: false, onAction: vi.fn(), initialState: { filters: { city: { value: 'Tokyo', componentType: 'Input' } } } };
    const view = render(<OpenUiSubmissionContext.Provider value={{ filters: 'submitting' }}><OpenUiRenderer {...props} /></OpenUiSubmissionContext.Provider>);
    expect(await screen.findByPlaceholderText('Choose a city')).toHaveValue('Tokyo');
    expect(screen.getByRole('button', { name: 'Apply filters' })).toBeDisabled();
    view.rerender(<OpenUiSubmissionContext.Provider value={{ filters: 'submitted' }}><OpenUiRenderer {...props} /></OpenUiSubmissionContext.Provider>);
    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply filters' })).toBeEnabled();
  });
});

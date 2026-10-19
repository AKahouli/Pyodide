import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import OpenUiRenderer from './OpenUiRenderer';
import { getTableRows } from './data-exploration';

const program = 'root = Card([cities])\ncities = Table([Col("City"), Col("Visits", "number")], [["Tokyo", 10], ["Paris", 2], ["Osaka", 0]])';
describe('OpenUI table exploration', () => {
  it('sorts numeric values, filters and submits exact original selected values', async () => {
    const user = userEvent.setup(); const onAction = vi.fn();
    render(<OpenUiRenderer content={program} isStreaming={false} onAction={onAction} />);
    await screen.findByRole('table');
    await user.click(screen.getAllByRole('button', { name: 'openui.explore.sort' })[1]);
    expect(within(screen.getAllByRole('row')[1]).getByText('Osaka')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'openui.explore.filter' }), 'o');
    expect(screen.queryByText('Paris')).not.toBeInTheDocument();
    await user.click(screen.getAllByRole('checkbox')[0]);
    await user.click(screen.getByRole('button', { name: 'openui.explore.apply' }));
    await waitFor(() => expect(onAction).toHaveBeenCalledOnce());
    const event = onAction.mock.calls[0][0];
    expect(event.formState.__ysExplore['table:cities'].value).toEqual({ query: 'o', sortColumn: 1, direction: 'asc', selectedRows: [2] });
    expect(event.params.selectedRows).toEqual([{ index: 2, values: ['Osaka', 0] }]);
    // Recreate the renderer from the JSON that the existing interaction endpoint persists.
    const saved = JSON.parse(JSON.stringify(event.formState));
    render(<StrictMode><OpenUiRenderer content={program} isStreaming={false} onAction={vi.fn()} initialState={saved} /></StrictMode>);
    expect(screen.getAllByRole('textbox', { name: 'openui.explore.filter' })[1]).toHaveValue('o');
    expect(screen.getAllByRole('checkbox')[2]).toBeChecked();
  });

  it('uses original numeric row identities and stable ordering', () => {
    const rows = [['Tokyo', 10], ['Paris', 2], ['Osaka', 0], ['Kyoto', 2]];
    expect(getTableRows(rows, { query: '', sortColumn: 1, direction: 'asc' }).map(entry => entry.index)).toEqual([2, 1, 3, 0]);
    expect(getTableRows(rows, { query: 'TO', sortColumn: 1, direction: 'desc' }).map(entry => entry.row)).toEqual([['Tokyo', 10], ['Kyoto', 2]]);
  });
});

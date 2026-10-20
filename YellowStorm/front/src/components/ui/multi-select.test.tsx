import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MultiSelect } from './multi-select';

const options = [
  { value: 'alpha', label: 'Alpha', description: 'Use Alpha to reference the incident triage skill.' },
  { value: 'beta', label: 'Beta', description: 'Use Beta to reference the release review skill.' },
];

describe('MultiSelect opt-in option help', () => {
  it('keeps trigger tooltip control stable when opening and closing the popover', async () => {
    const user = userEvent.setup();
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    try {
      render(<MultiSelect options={options} value={[]} onValueChange={vi.fn()} controlTooltip='Choose skills.' />);
      await user.tab();
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Choose skills.');
      await user.click(screen.getByRole('combobox'));
      expect(screen.getByRole('listbox')).toBeVisible();
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect([...errors.mock.calls, ...warnings.mock.calls].flat().join(' ')).not.toMatch(/uncontrolled|controlled state/i);
    } finally {
      errors.mockRestore();
      warnings.mockRestore();
    }
  });
  it('keeps duplicate labels distinct by value while searching their shared label', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const duplicates = [
      { value: 'skill-first', label: 'Incident response', description: 'Reference the first incident-response skill.' },
      { value: 'skill-second', label: 'Incident response', description: 'Reference the second incident-response skill.' },
    ];
    render(<MultiSelect options={duplicates} value={[]} onValueChange={onChange} optionTooltips searchPlaceholder='Find a skill' />);
    await user.click(screen.getByRole('combobox'));
    const search = screen.getByPlaceholderText('Find a skill');
    await user.type(search, 'Incident response');
    expect(screen.getAllByRole('option', { name: 'Incident response' })).toHaveLength(2);
    await user.keyboard('{Home}');
    await user.keyboard('{ArrowDown}');
    const selected = screen.getAllByRole('option').find((option) => option.getAttribute('aria-selected') === 'true')!;
    const identity = selected.getAttribute('data-value');
    const expected = duplicates.find((option) => option.value === identity)!;
    expect(expected).toBeDefined();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(expected.description);
    expect(search).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith([expected.value]);
  });

  it('follows Command keyboard highlight while focus stays in search, and supports pointer help', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MultiSelect options={options} value={[]} onValueChange={onChange} optionTooltips searchPlaceholder='Find skills' searchTooltip='Filter the skill list without changing selection.' controlTooltip='Choose skills to reference from this connector.' />);
    await user.click(screen.getByRole('combobox'));
    const search = screen.getByPlaceholderText('Find skills');
    await waitFor(() => expect(search).toHaveFocus());
    await user.keyboard('{ArrowDown}');
    const highlighted = screen.getAllByRole('option').find((option) => option.getAttribute('aria-selected') === 'true')!;
    const expected = options.find((option) => highlighted.textContent?.includes(option.label))!;
    expect(await screen.findByRole('tooltip')).toHaveTextContent(expected.description);
    expect(search).toHaveFocus();
    expect(highlighted).toHaveAccessibleDescription(expected.description);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(search).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Filter the skill list without changing selection.' })).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Filter the skill list without changing selection.');
    await user.keyboard('{Enter}');
    expect(onChange).not.toHaveBeenCalled();
    await user.tab({ shift: true });
    await user.hover(screen.getByRole('option', { name: 'Alpha' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(options[0].description);
    await user.click(screen.getByRole('option', { name: 'Alpha' }));
    expect(onChange).toHaveBeenCalledWith(['alpha']);
  });

  it('describes selected-option removal and keeps keyboard removal scoped to the selected reference', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MultiSelect options={options} value={['alpha']} onValueChange={onChange} removeTooltip={(option) => `Detach ${option.label}; keep the library skill.`} />);
    const remove = screen.getByRole('button', { name: 'Detach Alpha; keep the library skill.' });
    await user.tab();
    await user.tab();
    expect(remove).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Detach Alpha; keep the library skill.');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith([]);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('keeps inline descriptions and selection behavior unchanged when not opted in', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MultiSelect options={options} value={[]} onValueChange={onChange} />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByText(options[0].description)).toBeVisible();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /Alpha/ }));
    expect(onChange).toHaveBeenCalledWith(['alpha']);
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_INDEX_DEFAULTS, SEARCH_QUERY_DEFAULTS, type FieldSearchIndex } from '../../searchSettings';
import { FieldSearchIndexPane } from './FieldSearchIndexPane';

const api = vi.hoisted(() => ({ getEffective: vi.fn() }));
vi.mock('../../searchSettings', async (importOriginal) => ({ ...(await importOriginal<object>()), searchSettingsApi: api }));
const translation = vi.hoisted(() => ({ t: (key: string, values?: Record<string, unknown>) => values ? `${key} ${JSON.stringify(values)}` : key }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => translation }));

const renderPane = (value: FieldSearchIndex | undefined, onChange = vi.fn()) => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <FieldSearchIndexPane value={value} onChange={onChange} fieldLabel='Body' />
  </QueryClientProvider>);
  return onChange;
};
const inputFor = (key: string) => screen.getByLabelText(`searchSettings.field.inputFor {"setting":"searchSettings.index.${key}","field":"Body"}`);

describe('FieldSearchIndexPane', () => {
  beforeEach(() => {
    api.getEffective.mockResolvedValue({ index: { ...SEARCH_INDEX_DEFAULTS, passageTargetChars: 800 }, search: SEARCH_QUERY_DEFAULTS });
  });

  it('is folded and says the global settings apply when nothing is set', () => {
    renderPane(undefined);
    expect(screen.getByRole('button', { name: /searchSettings.field.title/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('searchSettings.field.global')).toBeInTheDocument();
    expect(api.getEffective).not.toHaveBeenCalled();
  });

  it('sums up what the field sets', () => {
    renderPane({ passageTargetChars: 600, passageOverlapChars: 100, passages: false });
    const summary = screen.getByText(/searchSettings.field.custom/).textContent!;
    expect(summary).toContain('searchSettings.field.part.passageTargetChars {\\"value\\":\\"600\\"}');
    expect(summary).toContain('searchSettings.field.part.passageOverlapChars');
    expect(summary).toContain('searchSettings.field.part.passagesOff');
  });

  it('shows the global values as placeholders and clears to undefined', async () => {
    const onChange = renderPane({ passageTargetChars: 900 });
    fireEvent.click(screen.getByRole('button', { name: /searchSettings.field.title/ }));
    expect(await screen.findByPlaceholderText('800')).toBe(inputFor('passageTargetChars'));
    expect(screen.getByText('searchSettings.field.note')).toBeInTheDocument();
    fireEvent.change(inputFor('passageTargetChars'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    fireEvent.click(screen.getByRole('radio', { name: 'searchSettings.field.passages_no' }));
    expect(onChange).toHaveBeenLastCalledWith({ passageTargetChars: 900, passages: false });
  });

  it('flags sizes that do not agree with the global ones', async () => {
    renderPane({ passageOverlapChars: 700 });
    fireEvent.click(screen.getByRole('button', { name: /searchSettings.field.title/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('searchSettings.problems.overlap');
  });

  it('falls back to the built-ins when the global values cannot be read', async () => {
    api.getEffective.mockRejectedValue(new Error('down'));
    renderPane(undefined);
    fireEvent.click(screen.getByRole('button', { name: /searchSettings.field.title/ }));
    expect(inputFor('passageTargetChars')).toHaveAttribute('placeholder', '1000');
  });
});

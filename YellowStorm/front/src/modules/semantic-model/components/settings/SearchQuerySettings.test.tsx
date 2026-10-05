import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_QUERY_DEFAULTS } from '../../searchSettings';
import { SearchQuerySettings, parseStopWords } from './SearchQuerySettings';

const api = vi.hoisted(() => ({ getAdminSearch: vi.fn(), updateAdminSearch: vi.fn() }));
vi.mock('../../searchSettings', async (importOriginal) => ({ ...(await importOriginal<object>()), searchSettingsApi: api }));
vi.mock('@/lib/notifications', () => ({ showError: vi.fn(), showSuccess: vi.fn() }));
const translation = vi.hoisted(() => ({ t: (key: string, values?: Record<string, unknown>) => values ? `${key} ${JSON.stringify(values)}` : key }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => translation }));

const renderSettings = () => render(<QueryClientProvider client={new QueryClient()}><SearchQuerySettings /></QueryClientProvider>);
const saveButton = () => screen.getByText('settings.save').closest('button')!;

describe('SearchQuerySettings', () => {
  beforeEach(() => {
    api.getAdminSearch.mockResolvedValue({ settings: SEARCH_QUERY_DEFAULTS, configured: { maxLimit: 40, extraStopWords: ['acme'] }, defaults: SEARCH_QUERY_DEFAULTS });
    api.updateAdminSearch.mockImplementation(async (configured) => ({ settings: SEARCH_QUERY_DEFAULTS, configured, defaults: SEARCH_QUERY_DEFAULTS }));
  });

  it('loads what is set and saves decimals and extra stop words as a list', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByLabelText('searchSettings.search.maxLimit')).toHaveValue(40));
    expect(screen.getByLabelText('searchSettings.search.extraStopWords')).toHaveValue('acme');
    const similarity = screen.getByLabelText('searchSettings.search.minSimilarity');
    expect(similarity).toHaveAttribute('step', '0.01');
    expect(similarity).toHaveAttribute('placeholder', '0.4');

    fireEvent.change(similarity, { target: { value: '0.55' } });
    fireEvent.change(screen.getByLabelText('searchSettings.search.extraStopWords'), { target: { value: 'acme, contrat;  Acme\nsas' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.updateAdminSearch).toHaveBeenCalledWith({ maxLimit: 40, minSimilarity: 0.55, extraStopWords: ['acme', 'contrat', 'sas'] }));
  });

  it('blocks saving more results by default than the results limit', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByLabelText('searchSettings.search.maxLimit')).toHaveValue(40));
    fireEvent.change(screen.getByLabelText('searchSettings.search.defaultLimit'), { target: { value: '45' } });
    expect(screen.getByRole('alert')).toHaveTextContent('searchSettings.problems.limit');
    expect(saveButton()).toBeDisabled();
  });

  it('removes a field that is reset or emptied', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByLabelText('searchSettings.search.maxLimit')).toHaveValue(40));
    fireEvent.click(screen.getByLabelText('searchSettings.resetField {"field":"searchSettings.search.maxLimit"}'));
    fireEvent.change(screen.getByLabelText('searchSettings.search.extraStopWords'), { target: { value: ' ' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.updateAdminSearch).toHaveBeenCalledWith({}));
  });

  it('parses typed stop words once each', () => {
    expect(parseStopWords('de, la;the  De\n')).toEqual(['de', 'la', 'the']);
  });
});

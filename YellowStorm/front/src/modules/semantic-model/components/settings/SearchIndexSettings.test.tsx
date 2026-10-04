import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_INDEX_DEFAULTS } from '../../searchSettings';
import { SearchIndexSettings } from './SearchIndexSettings';

const api = vi.hoisted(() => ({ getAdminIndex: vi.fn(), updateAdminIndex: vi.fn() }));
vi.mock('../../searchSettings', async (importOriginal) => ({ ...(await importOriginal<object>()), searchSettingsApi: api }));
vi.mock('@/lib/notifications', () => ({ showError: vi.fn(), showSuccess: vi.fn() }));
const translation = vi.hoisted(() => ({ t: (key: string, values?: Record<string, unknown>) => values ? `${key} ${JSON.stringify(values)}` : key }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => translation }));

const renderSettings = () => render(<QueryClientProvider client={new QueryClient()}><SearchIndexSettings /></QueryClientProvider>);
const saveButton = () => screen.getByText('settings.save').closest('button')!;

describe('SearchIndexSettings', () => {
  beforeEach(() => {
    api.getAdminIndex.mockResolvedValue({ settings: SEARCH_INDEX_DEFAULTS, configured: { passageTargetChars: 900 }, defaults: SEARCH_INDEX_DEFAULTS });
    api.updateAdminIndex.mockImplementation(async (configured) => ({ settings: SEARCH_INDEX_DEFAULTS, configured, defaults: SEARCH_INDEX_DEFAULTS }));
  });

  it('loads what is set, shows the defaults and saves only what was set', async () => {
    renderSettings();
    const target = screen.getByLabelText('searchSettings.index.passageTargetChars');
    await waitFor(() => expect(target).toHaveValue(900));
    expect(screen.getByLabelText('searchSettings.index.passageMinChars')).toHaveAttribute('placeholder', '700');
    expect(screen.getByLabelText('searchSettings.index.longFieldChars')).toHaveAttribute('placeholder', '300');
    expect(screen.getByText('searchSettings.index.note')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('searchSettings.index.maxPassagesPerField'), { target: { value: '30' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.updateAdminIndex).toHaveBeenCalledWith({ passageTargetChars: 900, maxPassagesPerField: 30 }));
  });

  it('blocks saving when the smallest passage is not under the passage size', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByLabelText('searchSettings.index.passageTargetChars')).toHaveValue(900));
    fireEvent.change(screen.getByLabelText('searchSettings.index.passageMinChars'), { target: { value: '900' } });
    expect(screen.getByRole('alert')).toHaveTextContent('searchSettings.problems.passageOrder');
    expect(saveButton()).toBeDisabled();
  });

  it('blocks saving when the overlap is not under the smallest passage', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByLabelText('searchSettings.index.passageTargetChars')).toHaveValue(900));
    fireEvent.change(screen.getByLabelText('searchSettings.index.passageOverlapChars'), { target: { value: '700' } });
    expect(screen.getByRole('alert')).toHaveTextContent('searchSettings.problems.overlap');
    expect(saveButton()).toBeDisabled();
  });

  it('resets one field back to its default', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByLabelText('searchSettings.index.passageTargetChars')).toHaveValue(900));
    fireEvent.click(screen.getByLabelText('searchSettings.resetField {"field":"searchSettings.index.passageTargetChars"}'));
    expect(screen.getByLabelText('searchSettings.index.passageTargetChars')).toHaveValue(null);
    fireEvent.click(screen.getByLabelText('searchSettings.index.passageHeader'));
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.updateAdminIndex).toHaveBeenCalledWith({ passageHeader: false }));
  });
});

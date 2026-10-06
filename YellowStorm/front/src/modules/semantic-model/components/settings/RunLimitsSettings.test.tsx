import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunLimitsSettings } from './RunLimitsSettings';
import { OPEN_KEY } from './SettingsPane';

const api = vi.hoisted(() => ({ getAdminRunLimits: vi.fn(), updateAdminRunLimits: vi.fn() }));
vi.mock('../../api', () => ({ semanticModelApi: api }));
vi.mock('@/lib/notifications', () => ({ showError: vi.fn(), showSuccess: vi.fn() }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));

describe('RunLimitsSettings', () => {
  beforeEach(() => {
    // Panes start folded; these tests read the fields inside.
    localStorage.setItem(OPEN_KEY, JSON.stringify({ 'search-index': true, 'search-query': true, 'run-size': true, 'ai-calls': true }));
    api.getAdminRunLimits.mockResolvedValue({ configured: { maxRecordsPerRun: 20000 }, runLimits: {} });
    api.updateAdminRunLimits.mockImplementation(async (limits) => ({ configured: limits, runLimits: {} }));
  });

  it('shows each limit with its help and saves only what was set', async () => {
    render(<RunLimitsSettings />);
    const perRun = await screen.findByLabelText('settings.runLimits.maxRecordsPerRun');
    await waitFor(() => expect(perRun).toHaveValue(20000));
    expect(screen.getByText('settings.runLimits.maxValuesPerRunTip')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('settings.runLimits.maxValuesPerRun'), { target: { value: '200000' } });
    fireEvent.click(screen.getByText('settings.save'));
    await waitFor(() => expect(api.updateAdminRunLimits).toHaveBeenCalledWith({ maxRecordsPerRun: 20000, maxValuesPerRun: 200000 }));
  });

  it('blocks saving a value outside its range', async () => {
    render(<RunLimitsSettings />);
    fireEvent.change(await screen.findByLabelText('settings.runLimits.maxRunSources'), { target: { value: '0' } });
    expect(screen.getByText('settings.save').closest('button')).toBeDisabled();
  });
});

describe('RunLimitsSettings AI calls pane', () => {
  beforeEach(() => {
    localStorage.setItem(OPEN_KEY, JSON.stringify({ 'ai-calls': true }));
    api.getAdminRunLimits.mockResolvedValue({ configured: { maxRecordsPerRun: 20000 }, runLimits: {} });
    api.updateAdminRunLimits.mockImplementation(async (limits) => ({ configured: limits, runLimits: {} }));
  });

  it('shows only the AI limits and keeps the run size limits saved meanwhile', async () => {
    render(<RunLimitsSettings group='ai' />);
    const calls = await screen.findByLabelText('settings.runLimits.maxAiParallelCalls');
    expect(screen.queryByLabelText('settings.runLimits.maxRecordsPerRun')).not.toBeInTheDocument();
    // Another admin raised the records per run after this pane loaded.
    api.getAdminRunLimits.mockResolvedValue({ configured: { maxRecordsPerRun: 60000 }, runLimits: {} });

    fireEvent.change(calls, { target: { value: '12' } });
    fireEvent.click(screen.getByText('settings.save'));
    await waitFor(() => expect(api.updateAdminRunLimits).toHaveBeenCalledWith({ maxRecordsPerRun: 60000, maxAiParallelCalls: 12 }));
  });
});

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

describe('RunLimitsSettings saving pane', () => {
  beforeEach(() => {
    localStorage.setItem(OPEN_KEY, JSON.stringify({ 'save-data': true }));
    api.getAdminRunLimits.mockResolvedValue({ configured: { purgeTimeoutSeconds: 600 }, runLimits: {} });
    api.updateAdminRunLimits.mockImplementation(async (limits) => ({ configured: limits, runLimits: {} }));
  });

  it('saves the batch size and the time per batch with the other limits, and refuses values out of range', async () => {
    render(<RunLimitsSettings group='save' />);
    const rows = await screen.findByLabelText('settings.runLimits.saveBatchRows');
    const seconds = screen.getByLabelText('settings.runLimits.saveStatementSeconds');
    expect(screen.queryByLabelText('settings.runLimits.purgeTimeoutSeconds')).not.toBeInTheDocument();

    fireEvent.change(rows, { target: { value: '99' } });
    expect(screen.getByText('settings.save').closest('button')).toBeDisabled();
    fireEvent.change(seconds, { target: { value: '601' } });
    expect(screen.getByText('settings.save').closest('button')).toBeDisabled();
    fireEvent.change(rows, { target: { value: '10000' } });
    fireEvent.change(seconds, { target: { value: '120' } });
    fireEvent.click(screen.getByText('settings.save'));
    await waitFor(() => expect(api.updateAdminRunLimits).toHaveBeenCalledWith({ purgeTimeoutSeconds: 600, saveBatchRows: 10000, saveStatementSeconds: 120 }));
  });
});

describe('RunLimitsSettings start-over pane', () => {
  beforeEach(() => {
    localStorage.setItem(OPEN_KEY, JSON.stringify({ rebuild: true }));
    api.getAdminRunLimits.mockResolvedValue({ configured: { maxAiParallelCalls: 12 }, runLimits: {} });
    api.updateAdminRunLimits.mockImplementation(async (limits) => ({ configured: limits, runLimits: {} }));
  });

  it('saves the purge time with the limits set elsewhere, and refuses one out of range', async () => {
    render(<RunLimitsSettings group='rebuild' />);
    const time = await screen.findByLabelText('settings.runLimits.purgeTimeoutSeconds');
    expect(screen.queryByLabelText('settings.runLimits.maxAiParallelCalls')).not.toBeInTheDocument();

    fireEvent.change(time, { target: { value: '10' } });
    expect(screen.getByText('settings.save').closest('button')).toBeDisabled();
    fireEvent.change(time, { target: { value: '900' } });
    fireEvent.click(screen.getByText('settings.save'));
    await waitFor(() => expect(api.updateAdminRunLimits).toHaveBeenCalledWith({ maxAiParallelCalls: 12, purgeTimeoutSeconds: 900 }));
  });
});

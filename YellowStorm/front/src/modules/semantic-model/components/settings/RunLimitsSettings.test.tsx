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

describe('RunLimitsSettings graph pane', () => {
  beforeEach(() => {
    localStorage.setItem(OPEN_KEY, JSON.stringify({ 'graph-build': true }));
    api.getAdminRunLimits.mockResolvedValue({ configured: { saveBatchRows: 5000 }, runLimits: {} });
    api.updateAdminRunLimits.mockImplementation(async (limits) => ({ configured: limits, runLimits: {} }));
  });

  it('saves the graph batch size between 100 and 20000 with the other limits', async () => {
    render(<RunLimitsSettings group='graph' />);
    const rows = await screen.findByLabelText('settings.runLimits.projectionBatchRows');
    expect(screen.queryByLabelText('settings.runLimits.saveBatchRows')).not.toBeInTheDocument();
    expect(rows).toHaveAttribute('placeholder', '5000');

    fireEvent.change(rows, { target: { value: '99' } });
    expect(screen.getByText('settings.save').closest('button')).toBeDisabled();
    fireEvent.change(rows, { target: { value: '20001' } });
    expect(screen.getByText('settings.save').closest('button')).toBeDisabled();
    fireEvent.change(rows, { target: { value: '20000' } });
    fireEvent.click(screen.getByText('settings.save'));
    await waitFor(() => expect(api.updateAdminRunLimits).toHaveBeenCalledWith({ saveBatchRows: 5000, projectionBatchRows: 20000 }));
  });
});

describe('RunLimitsSettings search index pane', () => {
  beforeEach(() => {
    localStorage.setItem(OPEN_KEY, JSON.stringify({ 'index-build': true }));
    api.getAdminRunLimits.mockResolvedValue({ configured: { saveBatchRows: 5000 }, runLimits: {} });
    api.updateAdminRunLimits.mockImplementation(async (limits) => ({ configured: limits, runLimits: {} }));
  });

  it('saves the embedding batch, parallel calls, call time and records per step with the other limits', async () => {
    render(<RunLimitsSettings group='index' />);
    const batch = await screen.findByLabelText('settings.runLimits.embeddingBatchSize');
    const calls = screen.getByLabelText('settings.runLimits.embeddingParallelCalls');
    const seconds = screen.getByLabelText('settings.runLimits.embeddingTimeoutSeconds');
    const rows = screen.getByLabelText('settings.runLimits.indexReadPageRows');
    expect(screen.queryByLabelText('settings.runLimits.saveBatchRows')).not.toBeInTheDocument();
    // The built-in values are the placeholders; nothing is saved for a field left empty.
    expect(batch).toHaveAttribute('placeholder', '32');
    expect(calls).toHaveAttribute('placeholder', '4');

    fireEvent.change(batch, { target: { value: '257' } });
    expect(screen.getByText('settings.save').closest('button')).toBeDisabled();
    fireEvent.change(batch, { target: { value: '64' } });
    fireEvent.change(calls, { target: { value: '17' } });
    expect(screen.getByText('settings.save').closest('button')).toBeDisabled();
    fireEvent.change(calls, { target: { value: '8' } });
    fireEvent.change(seconds, { target: { value: '4' } });
    expect(screen.getByText('settings.save').closest('button')).toBeDisabled();
    fireEvent.change(seconds, { target: { value: '120' } });
    fireEvent.change(rows, { target: { value: '499' } });
    expect(screen.getByText('settings.save').closest('button')).toBeDisabled();
    fireEvent.change(rows, { target: { value: '20000' } });
    fireEvent.click(screen.getByText('settings.save'));
    await waitFor(() => expect(api.updateAdminRunLimits).toHaveBeenCalledWith({
      saveBatchRows: 5000, embeddingBatchSize: 64, embeddingParallelCalls: 8, embeddingTimeoutSeconds: 120, indexReadPageRows: 20000 }));
  });
});

describe('RunLimitsSettings mail and attachment reading pane', () => {
  beforeEach(() => {
    localStorage.setItem(OPEN_KEY, JSON.stringify({ 'email-extraction': true }));
    api.getAdminRunLimits.mockResolvedValue({ configured: { maxRecordsPerRun: 20000 }, runLimits: {} });
    api.updateAdminRunLimits.mockImplementation(async (limits) => ({ configured: limits, runLimits: {} }));
  });

  it('shows only the reading limits with their built-in values, and saves them with the other limits', async () => {
    render(<RunLimitsSettings group='extraction' />);
    const attachmentChars = await screen.findByLabelText('settings.runLimits.maxAttachmentChars');
    expect(attachmentChars).toHaveAttribute('placeholder', '100000');
    expect(screen.getByLabelText('settings.runLimits.maxEmlMb')).toHaveAttribute('placeholder', '100');
    expect(screen.queryByLabelText('settings.runLimits.maxRecordsPerRun')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('settings.runLimits.parserMemoryMb')).not.toBeInTheDocument();

    fireEvent.change(attachmentChars, { target: { value: '40000' } });
    fireEvent.change(screen.getByLabelText('settings.runLimits.maxNesting'), { target: { value: '0' } });
    fireEvent.click(screen.getByText('settings.save'));
    // Zero nesting is a choice (attached e-mails are listed, not opened), not an empty field.
    await waitFor(() => expect(api.updateAdminRunLimits).toHaveBeenCalledWith({ maxRecordsPerRun: 20000, maxAttachmentChars: 40000, maxNesting: 0 }));
  });

  it('refuses values outside the ranges the runtime accepts', async () => {
    render(<RunLimitsSettings group='extraction' />);
    const save = (await screen.findByText('settings.save')).closest('button')!;
    for (const [key, value] of [['maxNesting', '6'], ['maxPdfPages', '0'], ['maxSheetCells', '999'], ['maxAttachmentChars', '4999'], ['maxInflatedMb', '1025']]) {
      const field = screen.getByLabelText(`settings.runLimits.${key}`);
      fireEvent.change(field, { target: { value } });
      expect(save).toBeDisabled();
      fireEvent.change(field, { target: { value: '' } });
      expect(save).not.toBeDisabled();
    }
  });
});

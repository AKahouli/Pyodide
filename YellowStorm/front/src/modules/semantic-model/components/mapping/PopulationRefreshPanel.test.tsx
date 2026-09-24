import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConceptSourceMapping } from '../../types';
import { PopulationRefreshPanel } from './PopulationRefreshPanel';

const api = vi.hoisted(() => ({ requestPopulationRefresh: vi.fn(), getPopulationJob: vi.fn() }));

vi.mock('../../api', () => ({ semanticModelApi: api }));

const base = {
  workspaceId: 'w-1', status: 'ready', createdBy: 'u-1', createdAt: '2026-01-01', updatedAt: '2026-01-01',
};
const mappings = [
  { ...base, id: 'm-1', conceptId: 'c-1', documentId: 'd-1', documentName: 'customers.csv', sheetName: '', assetKind: 'csv', fieldMappings: [], identityFields: ['customer_id'] },
  { ...base, id: 'm-2', conceptId: 'c-1', documentId: 'd-2', documentName: 'notes.pdf', sheetName: '', assetKind: 'document', fieldMappings: [], identityFields: [] },
  { ...base, status: 'stale', id: 'm-3', conceptId: 'c-1', documentId: 'd-3', documentName: 'stale.csv', sheetName: '', assetKind: 'csv', fieldMappings: [], identityFields: [] },
] as ConceptSourceMapping[];

function renderPanel(canEdit = true, onAccepted?: (jobId: string) => void) {
  return render(<QueryClientProvider client={new QueryClient()}><PopulationRefreshPanel modelId='model-1' mappings={mappings} canEdit={canEdit} onAccepted={onAccepted} /></QueryClientProvider>);
}

describe('PopulationRefreshPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.requestPopulationRefresh.mockResolvedValue({ jobId: 'j-1', status: 'queued', progressUrl: '/jobs/j-1', reused: false, skipped: [] });
    api.getPopulationJob.mockResolvedValue({ jobId: 'j-1', jobType: 'population.run', modelId: 'model-1', state: 'completed', result: {}, errorCode: null });
  });

  it('prepares the whole model by default', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'populationRefresh.prepare' }));
    await waitFor(() => expect(api.requestPopulationRefresh).toHaveBeenCalledWith('model-1', {
      purpose: 'build',
      scope: { kind: 'model' },
    }));
    await waitFor(() => expect(api.getPopulationJob).toHaveBeenCalledWith('model-1', 'j-1'));
    expect(await screen.findByText('populationRefresh.status')).toBeInTheDocument();
  });

  it('reports accepted jobs to the persistent editor observer', async () => {
    const onAccepted = vi.fn();
    renderPanel(true, onAccepted);
    fireEvent.click(screen.getByRole('button', { name: 'populationRefresh.prepare' }));

    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith('j-1'));
  });

  it('refreshes a single structured mapping', async () => {
    const user = userEvent.setup();
    renderPanel();
    const scopeSelect = screen.getAllByRole('combobox')[0];
    await user.click(scopeSelect);
    await user.click(await screen.findByText('populationRefresh.singleMapping'));
    const mappingSelect = screen.getAllByRole('combobox')[1];
    await user.click(mappingSelect);
    await user.click(await screen.findByText('customers.csv'));
    fireEvent.click(screen.getByRole('button', { name: 'populationRefresh.refreshAction' }));
    await waitFor(() => expect(api.requestPopulationRefresh).toHaveBeenCalledWith('model-1', {
      purpose: 'refresh',
      scope: { kind: 'mapping', mappingId: 'm-1' },
    }));
  });

  it('stops polling and exposes a terminal failure', async () => {
    api.getPopulationJob.mockResolvedValueOnce({ jobId: 'j-1', jobType: 'population.run', modelId: 'model-1', state: 'failed', result: null, errorCode: 'projection_failed' });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'populationRefresh.prepare' }));

    expect(await screen.findByText(/projection_failed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'populationRefresh.prepare' })).toBeEnabled();
    expect(api.getPopulationJob).toHaveBeenCalledTimes(1);
  });

  it('recovers from a polling request failure', async () => {
    api.getPopulationJob.mockRejectedValueOnce(new Error('network unavailable'));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'populationRefresh.prepare' }));

    expect(await screen.findByText('network unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'action.retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'populationRefresh.prepare' })).toBeEnabled();
  });

  it('lists only structured mappings as single-mapping candidates', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getAllByRole('combobox')[0]);
    await user.click(await screen.findByText('populationRefresh.singleMapping'));
    await user.click(screen.getAllByRole('combobox')[1]);
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).queryByText('notes.pdf')).not.toBeInTheDocument();
    expect(within(listbox).queryByText('stale.csv')).not.toBeInTheDocument();
    expect(within(listbox).getByText('customers.csv')).toBeInTheDocument();
  });

  it('disables actions for viewers and without a selected mapping', () => {
    renderPanel(false);
    expect(screen.getByRole('button', { name: 'populationRefresh.prepare' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'populationRefresh.refreshAction' })).toBeDisabled();
  });
});

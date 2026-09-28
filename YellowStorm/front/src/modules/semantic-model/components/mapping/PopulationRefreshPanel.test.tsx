import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    expect(await screen.findByText(/populationRefresh.state.completed/)).toBeInTheDocument();
  });

  it('reports accepted jobs to the persistent editor observer', async () => {
    const onAccepted = vi.fn();
    renderPanel(true, onAccepted);
    fireEvent.click(screen.getByRole('button', { name: 'populationRefresh.prepare' }));

    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith('j-1'));
  });

  it('stops polling and exposes a terminal failure', async () => {
    api.getPopulationJob.mockResolvedValueOnce({ jobId: 'j-1', jobType: 'population.run', modelId: 'model-1', state: 'failed', result: null, errorCode: 'parser_timeout' });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'populationRefresh.prepare' }));

    expect(await screen.findByText(/populationRefresh.errorCode.parser_timeout/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'populationRefresh.prepare' })).toBeEnabled();
    expect(api.getPopulationJob).toHaveBeenCalledTimes(1);
  });

  it('explains unknown runtime error codes generically', async () => {
    api.getPopulationJob.mockResolvedValueOnce({ jobId: 'j-1', jobType: 'population.run', modelId: 'model-1', state: 'failed', result: null, errorCode: 'projection_failed' });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'populationRefresh.prepare' }));

    expect(await screen.findByText(/populationRefresh.errorCode.unknown/)).toBeInTheDocument();
    expect(screen.queryByText(/projection_failed/)).not.toBeInTheDocument();
  });

  it('recovers from a polling request failure', async () => {
    api.getPopulationJob.mockRejectedValueOnce(new Error('network unavailable'));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'populationRefresh.prepare' }));

    expect(await screen.findByText('network unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'action.retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'populationRefresh.prepare' })).toBeEnabled();
  });

  it('disables actions for viewers', () => {
    renderPanel(false);
    expect(screen.getByRole('button', { name: 'populationRefresh.prepare' })).toBeDisabled();
  });
});

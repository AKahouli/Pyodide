import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyJobsPage, MyJobsQuery, MySemanticJob } from '../../types';
import { MyJobsDrawer } from './MyJobsDrawer';

const api = vi.hoisted(() => ({ myJobs: vi.fn(), stopMyJob: vi.fn(), removeMyQueuedJobs: vi.fn() }));
vi.mock('../../api', () => ({ semanticModelApi: api }));

const job = (id: string, overrides: Partial<MySemanticJob> = {}): MySemanticJob => ({
  jobId: id, jobType: 'population.run', modelId: 'm1', modelName: 'Mail', conceptLabel: 'Fait',
  canManage: true, state: 'queued', purpose: 'refresh', scope: { kind: 'concept', conceptId: 'fact' },
  result: null, errorCode: null, createdAt: new Date().toISOString(), ...overrides,
});
const models = [{ id: 'm1', name: 'Mail', canManage: true }, { id: 'm2', name: 'Shared', canManage: false }];
const response = (items: MySemanticJob[], totalPages = 1): MyJobsPage => ({
  items, models, pagination: { page: 1, limit: 20, total: items.length, totalPages },
  activeCount: items.length, queuedCount: items.filter((item) => item.state === 'queued').length,
});

function show(initialModelId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const rendered = render(<QueryClientProvider client={client}><MemoryRouter><MyJobsDrawer initialModelId={initialModelId} onClose={vi.fn()} /></MemoryRouter></QueryClientProvider>);
  return { ...rendered, client };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.myJobs.mockResolvedValue(response([job('queued'), job('running', { state: 'running' }),
    job('saving', { state: 'running', progress: { phase: 'saving', cancellable: false } }),
    job('viewer', { modelId: 'm2', modelName: 'Shared', canManage: false })]));
  api.stopMyJob.mockResolvedValue(job('queued', { state: 'cancelled' }));
  api.removeMyQueuedJobs.mockResolvedValue({ cancelled: 1, skipped: 0 });
});

describe('MyJobsDrawer', () => {
  it('lists current model jobs and removes only the queued job without stopping newly running work', async () => {
    show('m1');
    const remove = await screen.findByRole('button', { name: 'myJobs.removeQueued' });
    expect(api.myJobs).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'm1', view: 'active' }));
    expect(screen.getAllByText('Fait · runHistory.purpose.refresh')).toHaveLength(4);
    fireEvent.click(remove);
    await waitFor(() => expect(api.stopMyJob).toHaveBeenCalledWith('queued', true));
    const stops = screen.getAllByRole('button', { name: 'runStop.stop' });
    expect(stops).toHaveLength(2);
    expect(stops[1]).toBeDisabled();
    expect(screen.getByText('myJobs.savingHint')).toBeInTheDocument();
  });

  it('requires confirmation to stop a running job and passes running-stop intent', async () => {
    show();
    await screen.findByText('myJobs.saving');
    fireEvent.click(screen.getAllByRole('button', { name: 'runStop.stop' })[0]);
    expect(api.stopMyJob).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'runStop.confirmAction' }));
    await waitFor(() => expect(api.stopMyJob).toHaveBeenCalledWith('running', false));
  });

  it('bulk removal confirms the selected filter and covers all queued pages', async () => {
    api.myJobs.mockResolvedValue({ ...response([job('queued')], 3), queuedCount: 41 });
    show('m1');
    fireEvent.click(await screen.findByRole('button', { name: 'myJobs.removeAll' }));
    expect(api.removeMyQueuedJobs).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'myJobs.confirmRemoveAll' }));
    await waitFor(() => expect(api.removeMyQueuedJobs).toHaveBeenCalledWith('m1'));
  });

  it('changes model filter and history, retaining cancelled-before-starting entries', async () => {
    api.myJobs.mockImplementation(async (query: MyJobsQuery) => query.view === 'history'
      ? response([job('cancelled', { state: 'cancelled', startedAt: null })]) : response([job('queued')]));
    show('m1');
    await screen.findByText('Fait · runHistory.purpose.refresh');
    fireEvent.change(screen.getByRole('combobox', { name: 'myJobs.modelFilter' }), { target: { value: 'all' } });
    await waitFor(() => expect(api.myJobs).toHaveBeenCalledWith(expect.objectContaining({ modelId: undefined, view: 'active' })));
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'myJobs.history' }), { button: 0, ctrlKey: false });
    expect(await screen.findByText('myJobs.cancelledQueued')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'myJobs.removeQueued' })).not.toBeInTheDocument();
  });

  it('displays an actionable list error instead of a false empty queue', async () => {
    api.myJobs.mockRejectedValue(new Error('unavailable'));
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent('myJobs.unavailable');
    expect(screen.getByRole('button', { name: 'action.retry' })).toBeInTheDocument();
    expect(screen.queryByText('myJobs.emptyActive')).not.toBeInTheDocument();
  });
});

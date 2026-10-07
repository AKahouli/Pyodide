import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybookRunStatus } from './PlaybookRunStatus';

const api = vi.hoisted(() => ({ getFlowExecutionDetail: vi.fn(), cancelFlowExecution: vi.fn() }));
vi.mock('../../api', () => api);

function renderStatus() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PlaybookRunStatus executionId='e-1' /></QueryClientProvider>);
}

describe('PlaybookRunStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stops a running run only once the person confirms', async () => {
    api.getFlowExecutionDetail.mockResolvedValueOnce({ id: 'e-1', status: 'running' }).mockResolvedValue({ id: 'e-1', status: 'cancelled' });
    api.cancelFlowExecution.mockResolvedValue(undefined);
    renderStatus();
    fireEvent.click(await screen.findByText('playbookRun.stop'));
    expect(api.cancelFlowExecution).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('playbookRun.keep'));
    fireEvent.click(screen.getByText('playbookRun.stop'));
    fireEvent.click(screen.getByText('playbookRun.stopConfirm'));
    await waitFor(() => expect(api.cancelFlowExecution).toHaveBeenCalledWith('e-1'));
    expect(await screen.findByText('playbookRun.stopped')).toBeInTheDocument();
  });

  it('shows nothing for a finished run', async () => {
    api.getFlowExecutionDetail.mockResolvedValue({ id: 'e-1', status: 'completed' });
    renderStatus();
    await waitFor(() => expect(api.getFlowExecutionDetail).toHaveBeenCalled());
    expect(screen.queryByText('playbookRun.stop')).not.toBeInTheDocument();
  });

  it('says when the run could not be stopped', async () => {
    api.getFlowExecutionDetail.mockResolvedValue({ id: 'e-1', status: 'pending_approval' });
    api.cancelFlowExecution.mockRejectedValue({ statusCode: 409 });
    renderStatus();
    expect(await screen.findByText('playbookRun.waiting')).toBeInTheDocument();
    fireEvent.click(screen.getByText('playbookRun.stop'));
    fireEvent.click(screen.getByText('playbookRun.stopConfirm'));
    expect(await screen.findByRole('alert')).toHaveTextContent('playbookRun.stopFailed');
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SemanticModelValidateDialog } from './SemanticModelValidateDialog';

const mutations = vi.hoisted(() => ({ population: vi.fn(), rebuild: vi.fn() }));

vi.mock('../../hooks/use-population-run', () => ({
  usePopulationRun: () => ({ mutateAsync: mutations.population, isPending: false }),
  useRebuildFromScratch: () => ({ mutateAsync: mutations.rebuild, isPending: false }),
}));

describe('SemanticModelValidateDialog', () => {
  it('starts a whole-model population run on the runtime', async () => {
    mutations.population.mockResolvedValue({ jobId: 'job-1', status: 'queued', skipped: [], reused: false });
    const onPopulationStarted = vi.fn();
    const onOpenChange = vi.fn();
    render(<SemanticModelValidateDialog open onOpenChange={onOpenChange} modelId="model-1" onPopulationStarted={onPopulationStarted} />);

    expect(screen.queryByRole('button', { name: 'validate.launch' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'population.action' }));

    await waitFor(() => expect(mutations.population).toHaveBeenCalledWith({ kind: 'model' }));
    expect(onPopulationStarted).toHaveBeenCalledWith({ jobId: 'job-1', status: 'queued', skipped: [], reused: false });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mutations.rebuild).not.toHaveBeenCalled();
  });

  it('repopulates from scratch only once the warning is confirmed', async () => {
    mutations.rebuild.mockResolvedValue({ jobId: 'job-2', status: 'queued', skipped: [], reused: false, cleared: { revisions: 3 } });
    const onPopulationStarted = vi.fn();
    render(<SemanticModelValidateDialog open onOpenChange={vi.fn()} modelId="model-1" onPopulationStarted={onPopulationStarted} />);

    await userEvent.click(screen.getByRole('button', { name: /rebuild.button/ }));
    expect(mutations.rebuild).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('rebuild.kept');

    // Going back leaves everything as it was.
    await userEvent.click(screen.getByRole('button', { name: 'action.cancel' }));
    expect(screen.getByRole('button', { name: 'population.action' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /rebuild.button/ }));
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'rebuild.confirm' }));

    await waitFor(() => expect(mutations.rebuild).toHaveBeenCalledWith({ forgetDocumentReading: true }));
    expect(onPopulationStarted).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-2', cleared: true }));
  });
});

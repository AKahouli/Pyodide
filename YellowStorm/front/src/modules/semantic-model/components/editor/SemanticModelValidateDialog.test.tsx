import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SemanticModelValidateDialog } from './SemanticModelValidateDialog';

const mutations = vi.hoisted(() => ({ population: vi.fn(), rebuild: vi.fn(), reproject: vi.fn() }));

vi.mock('../../hooks/use-population-run', () => ({
  usePopulationRun: () => ({ mutateAsync: mutations.population, isPending: false }),
  useRebuildFromScratch: () => ({ mutateAsync: mutations.rebuild, isPending: false }),
  useReprojectGraph: () => ({ mutateAsync: mutations.reproject, isPending: false }),
}));

describe('SemanticModelValidateDialog', () => {
  beforeEach(() => { mutations.population.mockReset(); mutations.rebuild.mockReset(); mutations.reproject.mockReset(); });

  it('reads the sources by default, with one button', async () => {
    mutations.population.mockResolvedValue({ jobId: 'job-1', status: 'queued', skipped: [], reused: false });
    const onPopulationStarted = vi.fn();
    const onOpenChange = vi.fn();
    render(<SemanticModelValidateDialog open onOpenChange={onOpenChange} modelId="model-1" onPopulationStarted={onPopulationStarted} />);

    expect(screen.getByRole('radio', { name: /run.mode.update.title/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /rebuild.forget/ })).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'run.mode.update.action' }));

    await waitFor(() => expect(mutations.population).toHaveBeenCalledWith({ rereadDocuments: false }));
    expect(onPopulationStarted).toHaveBeenCalledWith({ jobId: 'job-1', status: 'queued', skipped: [], reused: false });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mutations.rebuild).not.toHaveBeenCalled();
  });

  it('updates the data and reads the documents again with AI when ticked', async () => {
    mutations.population.mockResolvedValue({ jobId: 'job-3', status: 'queued', skipped: [], reused: false });
    render(<SemanticModelValidateDialog open onOpenChange={vi.fn()} modelId="model-1" />);

    await userEvent.click(screen.getByRole('checkbox', { name: /rebuild.forget/ }));
    await userEvent.click(screen.getByRole('button', { name: 'run.mode.update.action' }));

    await waitFor(() => expect(mutations.population).toHaveBeenCalledWith({ rereadDocuments: true }));
    expect(mutations.rebuild).not.toHaveBeenCalled();
  });

  it('rebuilds only the graph: no run is started', async () => {
    mutations.reproject.mockResolvedValue({ modelId: 'model-1', revisions: [{ revisionId: 'dr-1', projectionRef: 'age:v2:pop_dr_1_t2', reprojected: true, vertices: 217, edges: 195 }] });
    const onOpenChange = vi.fn();
    render(<SemanticModelValidateDialog open onOpenChange={onOpenChange} modelId="model-1" />);

    await userEvent.click(screen.getByRole('radio', { name: /run.mode.graph.title/ }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'run.mode.graph.action' }));

    await waitFor(() => expect(mutations.reproject).toHaveBeenCalledTimes(1));
    expect(mutations.population).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('starting over shows what is deleted, offers the AI reading, and passes it along', async () => {
    mutations.rebuild.mockResolvedValue({ jobId: 'job-2', status: 'queued', skipped: [], reused: false, cleared: { revisions: 3 } });
    const onPopulationStarted = vi.fn();
    render(<SemanticModelValidateDialog open onOpenChange={vi.fn()} modelId="model-1" onPopulationStarted={onPopulationStarted} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /run.mode.scratch.title/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('rebuild.kept');
    await userEvent.click(screen.getByRole('checkbox', { name: /rebuild.forget/ }));
    await userEvent.click(screen.getByRole('button', { name: 'run.mode.scratch.action' }));

    await waitFor(() => expect(mutations.rebuild).toHaveBeenCalledWith({ forgetDocumentReading: true }));
    expect(onPopulationStarted).toHaveBeenCalledWith({ jobId: 'job-2', status: 'queued', skipped: [], reused: false, cleared: true });
    expect(mutations.population).not.toHaveBeenCalled();
  });
});

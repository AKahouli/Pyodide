import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SemanticModelValidateDialog } from './SemanticModelValidateDialog';

const mutations = vi.hoisted(() => ({ population: vi.fn() }));

vi.mock('../../hooks/use-population-run', () => ({
  usePopulationRun: () => ({ mutateAsync: mutations.population, isPending: false }),
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
  });
});

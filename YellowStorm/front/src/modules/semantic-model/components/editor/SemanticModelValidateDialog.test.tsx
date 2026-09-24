import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SemanticModelValidateDialog } from './SemanticModelValidateDialog';

const mutations = vi.hoisted(() => ({ build: vi.fn(), population: vi.fn() }));

vi.mock('../../hooks/use-semantic-build-job', () => ({
  useStartSemanticBuild: () => ({ mutateAsync: mutations.build, isPending: false }),
}));
vi.mock('../../hooks/use-population-run', () => ({
  usePopulationRun: () => ({ mutateAsync: mutations.population, isPending: false }),
}));

describe('SemanticModelValidateDialog', () => {
  it('routes runtime-owned generation through population without offering the legacy build', async () => {
    mutations.build.mockClear();
    mutations.population.mockResolvedValue({ jobId: 'job-1', status: 'queued', skipped: [], reused: false });
    const onPopulationStarted = vi.fn();
    render(<SemanticModelValidateDialog open onOpenChange={vi.fn()} modelId="model-1" runtimeOwned onPopulationStarted={onPopulationStarted} />);

    expect(screen.queryByRole('button', { name: 'validate.launch' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('validate.requirementsPlaceholder')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'population.action' }));

    await waitFor(() => expect(mutations.population).toHaveBeenCalledWith({ kind: 'model' }));
    expect(onPopulationStarted).toHaveBeenCalledWith({ jobId: 'job-1', status: 'queued', skipped: [], reused: false });
    expect(mutations.build).not.toHaveBeenCalled();
  });
});

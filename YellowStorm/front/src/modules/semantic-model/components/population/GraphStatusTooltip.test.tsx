import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GraphStatusTooltip } from './GraphStatusTooltip';

const served = (environment: 'draft' | 'production', overrides: Record<string, unknown> = {}) => ({
  environment, dataRevisionId: `dr_${environment}`, modelVersionId: 'v-1', projectionRef: `age:v2:pop_dr_${environment}_t2`,
  graphSchema: `pop_dr_${environment}_t2`, layout: 'typed', builtAt: '2026-10-06T06:49:36Z',
  stored: { records: 217, links: 195 }, graph: { vertices: 217, edges: 195, conceptLabels: 5, relationLabels: 5 },
  state: 'ok', index: { state: 'ready', expectedCount: 217, indexedCount: 213 }, ...overrides,
});

vi.mock('../../query/hooks', () => ({
  useGraphStatus: () => ({ data: { modelId: 'm', environments: [
    served('draft', { layout: 'entity', state: 'mismatch', graph: { vertices: 200, edges: 190, conceptLabels: 0, relationLabels: 0 } }),
    served('production'),
  ] }, isLoading: false, isError: false }),
}));

describe('GraphStatusTooltip', () => {
  it('shows the schema, revision and state of the graph each environment uses, published first', async () => {
    render(<GraphStatusTooltip modelId='m' />);
    await userEvent.click(screen.getByRole('button', { name: 'graphStatus.title' }));

    const sections = await screen.findAllByText(/graphStatus\.environment\./);
    expect(sections.map((node) => node.textContent)).toEqual(['graphStatus.environment.production', 'graphStatus.environment.draft']);
    expect(screen.getByText('pop_dr_production_t2')).toBeInTheDocument();
    expect(screen.getByText('dr_draft')).toBeInTheDocument();
    expect(screen.getByText('graphStatus.state.mismatch')).toBeInTheDocument();
    expect(screen.getByText('graphStatus.layouts.entity')).toBeInTheDocument();
    expect(screen.getByText('graphStatus.rebuildHint')).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SemanticModelCatalogPage } from './SemanticModelCatalogPage';

const queryState = vi.hoisted(() => ({
  data: { items: [] } as { items: Array<{ id: string; status: string; recordCount?: number; brokenBindingCount?: number }> },
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../query/hooks', () => ({
  useSemanticModels: () => queryState,
}));

vi.mock('../components/catalog/SemanticModelCard', () => ({
  SemanticModelCard: ({ model }: { model: { id: string } }) => <div>model-{model.id}</div>,
}));

vi.mock('../components/catalog/CreateSemanticModelDialog', () => ({
  CreateSemanticModelDialog: ({ open }: { open: boolean }) => open ? <div role='dialog'>create-model-dialog</div> : null,
}));

describe('SemanticModelCatalogPage', () => {
  beforeEach(() => {
    queryState.data = { items: [] };
    queryState.isLoading = false;
    queryState.isError = false;
    queryState.isFetching = false;
    queryState.refetch.mockReset();
  });

  it('renders a recoverable query error instead of the empty catalog', async () => {
    queryState.isError = true;

    render(<MemoryRouter><SemanticModelCatalogPage /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: 'catalog.errorTitle' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'catalog.emptyTitle' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'action.retry' }));
    expect(queryState.refetch).toHaveBeenCalledOnce();
  });

  it('distinguishes the true empty catalog from filtered empty results', async () => {
    render(<MemoryRouter><SemanticModelCatalogPage /></MemoryRouter>);

    expect(screen.getByRole('heading', { name: 'catalog.emptyTitle' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'catalog.section.designed' }));
    expect(screen.getByRole('heading', { name: 'catalog.filteredEmptyTitle' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'catalog.clearFilters' })).toBeInTheDocument();
  });

  it('opens creation without changing the catalog route', async () => {
    render(<MemoryRouter initialEntries={['/semantic-models']}><SemanticModelCatalogPage /></MemoryRouter>);

    await userEvent.click(screen.getAllByRole('button', { name: 'catalog.create' })[0]);
    expect(screen.getByRole('dialog')).toHaveTextContent('create-model-dialog');
  });
});

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
  filters: [] as Array<Record<string, string | number | undefined>>,
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../query/hooks', () => ({
  useSemanticModels: (filters: Record<string, string | number | undefined>) => { queryState.filters.push(filters); return queryState; },
}));

vi.mock('../components/catalog/SemanticModelRow', () => ({
  SemanticModelRow: ({ model }: { model: { id: string } }) => <tr><td>model-{model.id}</td></tr>,
}));

vi.mock('../components/catalog/CreateSemanticModelDialog', () => ({
  CreateSemanticModelDialog: ({ open }: { open: boolean }) => open ? <div role='dialog'>create-model-dialog</div> : null,
}));

vi.mock('../components/population/MyJobsDrawer', () => ({
  MyJobsButton: () => null,
}));

describe('SemanticModelCatalogPage', () => {
  beforeEach(() => {
    queryState.data = { items: [] };
    queryState.isLoading = false;
    queryState.isError = false;
    queryState.isFetching = false;
    queryState.refetch.mockReset();
    queryState.filters = [];
  });

  it('asks only for the models shared with the user from the shared tab', async () => {
    render(<MemoryRouter><SemanticModelCatalogPage /></MemoryRouter>);

    expect(queryState.filters.at(-1)?.scope).toBeUndefined();
    await userEvent.click(screen.getByRole('tab', { name: 'catalog.section.shared' }));
    expect(queryState.filters.at(-1)?.scope).toBe('shared');
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
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'catalog.filter.kind' }), 'designed');
    expect(screen.getByRole('heading', { name: 'catalog.filteredEmptyTitle' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'catalog.clearFilters' })).toBeInTheDocument();
  });

  it('combines scope, type and publication filters and clears all of them', async () => {
    render(<MemoryRouter><SemanticModelCatalogPage /></MemoryRouter>);
    await userEvent.click(screen.getByRole('tab', { name: 'catalog.section.shared' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'catalog.filter.kind' }), 'workspace_default');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'catalog.filter.status' }), 'published');
    await userEvent.type(screen.getByRole('textbox', { name: 'catalog.search' }), 'contract');

    expect(queryState.filters.at(-1)).toEqual({ search: 'contract', scope: 'shared', kind: 'workspace_default', status: 'published' });
    await userEvent.click(screen.getAllByRole('button', { name: 'catalog.clearFilters' })[0]);
    expect(queryState.filters.at(-1)).toEqual({ search: undefined, scope: undefined, kind: undefined, status: undefined });
    expect(screen.getByRole('combobox', { name: 'catalog.filter.content' })).toHaveValue('all');
    expect(screen.getByRole('combobox', { name: 'catalog.filter.status' })).toHaveValue('active');
  });

  it('shows non-archived rows and filters records and attention without confusing publication status', async () => {
    queryState.data.items = [
      { id: 'draft', status: 'draft', recordCount: 0 },
      { id: 'published', status: 'published', recordCount: 2, brokenBindingCount: 1 },
      { id: 'archived', status: 'archived', recordCount: 3 },
    ];
    render(<MemoryRouter><SemanticModelCatalogPage /></MemoryRouter>);
    expect(screen.getByRole('table', { name: 'catalog.title' })).toBeInTheDocument();
    expect(screen.getByText('model-draft')).toBeInTheDocument();
    expect(screen.queryByText('model-archived')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'catalog.filter.content' }), 'records');
    expect(screen.queryByText('model-draft')).not.toBeInTheDocument();
    expect(screen.getByText('model-published')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'catalog.filter.content' }), 'attention');
    expect(screen.getByText('model-published')).toBeInTheDocument();
    expect(queryState.filters.at(-1)?.status).toBeUndefined();
    await userEvent.click(screen.getByRole('button', { name: 'catalog.clearFilters' }));
    expect(screen.getByText('model-draft')).toBeInTheDocument();
  });

  it('opens creation without changing the catalog route', async () => {
    render(<MemoryRouter initialEntries={['/semantic-models']}><SemanticModelCatalogPage /></MemoryRouter>);

    await userEvent.click(screen.getAllByRole('button', { name: 'catalog.create' })[0]);
    expect(screen.getByRole('dialog')).toHaveTextContent('create-model-dialog');
  });
});
